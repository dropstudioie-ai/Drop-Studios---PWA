-- Drop Studios — an unfinished checkout no longer blocks a new one.
--
-- Before: an unpaid Intro Offer checkout blocked another for an hour
-- ('intro_checkout_in_progress') and nobody could clear it.
-- Now: starting a new membership checkout cancels the member's unfinished ones
-- (create-checkout first confirms with Square that none was paid and switches
-- their payment links off). Admins can cancel an unfinished checkout too. If an
-- old checkout is paid anyway, the payment is honoured and flagged for review.

alter table public.payments
  add column provider_link_id text,
  add column review_reason text;

create or replace function public.create_checkout(
  p_plan_id uuid,
  p_selected_style_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'square'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_snap jsonb;
  pay public.payments;
  v_superseded jsonb := '[]';
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(v_uid) then perform public._fail('profile_photo_required'); end if;
  if p_provider not in ('square', 'stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;

  -- Serialise checkouts per customer.
  perform 1 from public.profiles where id = v_uid for update;

  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if pay.plan_id <> p_plan_id then perform public._fail('idempotency_conflict'); end if;
  else
    v_snap := public._plan_snapshot(v_uid, p_plan_id, p_selected_style_id, true);

    -- A new checkout replaces any unfinished membership checkout of this member
    -- (nothing was paid on those). create-checkout has already checked with
    -- Square that none of them was paid, and switched their payment links off.
    with gone as (
      update public.payments
      set status = 'cancelled', failure_reason = 'replaced by a new checkout'
      where user_id = v_uid and kind = 'membership' and status = 'pending'
      returning id, plan_snapshot ->> 'plan_name' as plan_name, created_at
    )
    select coalesce(jsonb_agg(jsonb_build_object('payment_id', id, 'plan_name', plan_name, 'created_at', created_at)), '[]')
    into v_superseded from gone;
    if jsonb_array_length(v_superseded) > 0 then
      perform public._audit('checkout_superseded', 'profile', v_uid::text, jsonb_build_object('payments', v_superseded));
    end if;

    insert into public.payments (
      user_id, plan_id, selected_style_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, p_plan_id, (v_snap ->> 'selected_style_id')::uuid, v_snap,
      (v_snap ->> 'price_cents')::int, v_snap ->> 'currency',
      p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid
    ) returning * into pay;
  end if;

  return jsonb_build_object(
    'payment_id', pay.id,
    'status', pay.status,
    'amount_cents', pay.amount_cents,
    'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name',
    'class_count', (pay.plan_snapshot ->> 'class_count')::int,
    'provider', pay.provider,
    'provider_session_id', pay.provider_session_id,
    'is_test', pay.is_test,
    'superseded', v_superseded
  );
end;
$$;

create or replace function public.fulfill_payment(
  p_payment_id uuid,
  p_provider public.payment_provider,
  p_provider_ref text,
  p_provider_event_id text,
  p_amount_cents int,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
  v_membership_id uuid;
  v_was_cancelled boolean;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;

  if pay.status = 'succeeded' then
    if pay.kind <> 'membership' then
      return jsonb_build_object('ok', true, 'booking_id', pay.booking_id, 'duplicate', true);
    end if;
    select m.id into v_membership_id
    from public.membership_purchases pu join public.memberships m on m.purchase_id = pu.id
    where pu.payment_id = pay.id;
    return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', true);
  end if;

  if pay.provider <> p_provider then perform public._fail('provider_mismatch'); end if;
  if pay.status not in ('pending', 'cancelled', 'failed') then perform public._fail('payment_not_fulfillable', pay.status::text); end if;

  if p_amount_cents is distinct from pay.amount_cents or upper(p_currency) is distinct from upper(pay.currency) then
    update public.payments set status = 'failed',
      failure_reason = format('amount mismatch: expected %s %s, got %s %s', pay.amount_cents, pay.currency, p_amount_cents, p_currency)
    where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  -- Paid although the checkout had been replaced or cancelled (e.g. the member
  -- paid in an old tab). The money was taken, so it is honoured, and the studio
  -- is asked to review it (a second Intro Offer may need a refund).
  v_was_cancelled := pay.status in ('cancelled', 'failed');

  update public.payments
  set status = 'succeeded', completed_at = now(),
      review_reason = case when v_was_cancelled then 'paid_after_cancel' end, provider_payment_ref = p_provider_ref,
      provider_event_id = p_provider_event_id, failure_reason = null
  where id = pay.id
  returning * into pay;

  if v_was_cancelled then
    perform public._audit('payment_review_required', 'payment', pay.id::text,
      jsonb_build_object('reason', 'paid_after_cancel', 'user_id', pay.user_id, 'amount_cents', pay.amount_cents,
                         'plan_name', pay.plan_snapshot ->> 'plan_name'));
    insert into public.notification_outbox (user_id, kind, payload)
    select a.id, 'payment_review', jsonb_build_object(
      'member_name', (select full_name from public.profiles where id = pay.user_id),
      'plan_name', pay.plan_snapshot ->> 'plan_name', 'amount_cents', pay.amount_cents, 'user_id', pay.user_id)
    from public.profiles a where a.role = 'admin';
  end if;

  if pay.kind <> 'membership' then
    return public._confirm_ticket(pay) || jsonb_build_object('duplicate', false);
  end if;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$$;

-- Admin: cancel a member's unfinished checkout (nothing has been paid on it).
create or replace function public.admin_cancel_checkout(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
begin
  perform public._require_admin();
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;
  if pay.status <> 'pending' then perform public._fail('payment_not_pending'); end if;
  if pay.booking_id is not null then
    -- A ticket / Drop In hold: release the spot as well.
    perform public._cancel_booking(pay.booking_id, true, 'Checkout cancelled by the studio', false);
  end if;
  update public.payments set status = 'cancelled', failure_reason = 'cancelled by the studio' where id = pay.id;
  perform public._audit('checkout_cancelled', 'payment', pay.id::text, jsonb_build_object('user_id', pay.user_id));
  return jsonb_build_object('status', 'cancelled');
end;
$$;

-- Admin: mark a flagged payment as reviewed.
create or replace function public.admin_resolve_payment_review(p_payment_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if coalesce(btrim(p_note), '') = '' then perform public._fail('reason_required'); end if;
  update public.payments set review_reason = null where id = p_payment_id and review_reason is not null;
  if not found then perform public._fail('payment_not_found'); end if;
  perform public._audit('payment_reviewed', 'payment', p_payment_id::text, jsonb_build_object('note', p_note));
end;
$$;

revoke execute on function public.admin_cancel_checkout(uuid), public.admin_resolve_payment_review(uuid, text) from public, anon;
grant execute on function public.admin_cancel_checkout(uuid), public.admin_resolve_payment_review(uuid, text) to authenticated;
