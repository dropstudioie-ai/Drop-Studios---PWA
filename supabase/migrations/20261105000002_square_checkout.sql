-- Accept 'square' as an online checkout provider and make it the default.
-- Function bodies are otherwise unchanged from 20261029000003 / 20261030000002.

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
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_provider not in ('square', 'stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;

  -- Serialise checkouts per customer.
  perform 1 from public.profiles where id = v_uid for update;

  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if pay.plan_id <> p_plan_id then perform public._fail('idempotency_conflict'); end if;
  else
    v_snap := public._plan_snapshot(v_uid, p_plan_id, p_selected_style_id, true);

    if (v_snap ->> 'first_time_only')::boolean and exists (
      select 1 from public.payments
      where user_id = v_uid and status = 'pending' and (plan_snapshot ->> 'first_time_only')::boolean
        and created_at > now() - interval '1 hour'
    ) then
      perform public._fail('intro_checkout_in_progress');
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
    'is_test', pay.is_test
  );
end;
$$;

create or replace function public.create_ticket_checkout(
  p_session_id uuid,
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
  s public.class_sessions;
  pay public.payments;
  v_booking_id uuid;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_provider not in ('square', 'stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;

  perform public.release_expired_holds(s.id);
  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if not found then
    -- Returning to a checkout already in progress: resume it instead of failing.
    select p.* into pay from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.user_id = v_uid and p.session_id = s.id and p.status = 'pending' and b.status = 'pending_payment';
  end if;
  if not found then
    select * into s from public.class_sessions where id = p_session_id;

    if not s.is_special or s.ticket_price_cents is null then perform public._fail('tickets_not_available'); end if;
    if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;
    if s.starts_at <= now() then perform public._fail('session_started'); end if;
    if exists (
      select 1 from public.bookings where user_id = v_uid and session_id = s.id
        and status in ('booked', 'attended', 'no_show', 'pending_payment')
    ) then perform public._fail('already_booked'); end if;
    if s.booked_count >= s.capacity then perform public._fail('session_full'); end if;

    insert into public.bookings (user_id, session_id, status, hold_expires_at)
    values (v_uid, s.id, 'pending_payment', now() + interval '35 minutes')
    returning id into v_booking_id;
    update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

    insert into public.payments (
      user_id, kind, session_id, booking_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, 'ticket', s.id, v_booking_id,
      jsonb_build_object('kind', 'ticket', 'plan_name', 'Ticket: ' || s.title, 'title', s.title,
                         'starts_at', s.starts_at, 'price_cents', s.ticket_price_cents, 'currency', 'EUR'),
      s.ticket_price_cents, 'EUR', p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid
    ) returning * into pay;
    update public.bookings set payment_id = pay.id where id = v_booking_id;
  elsif pay.session_id is distinct from p_session_id then
    perform public._fail('idempotency_conflict');
  end if;

  return jsonb_build_object(
    'payment_id', pay.id,
    'status', pay.status,
    'amount_cents', pay.amount_cents,
    'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name',
    'class_count', null,
    'provider', pay.provider,
    'provider_session_id', pay.provider_session_id,
    'is_test', pay.is_test
  );
end;
$$;
