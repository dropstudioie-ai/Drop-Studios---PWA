-- A cancelled paid class (Drop In or ticket): instead of an automatic "refund needed", the member is asked
-- whether they want a class credit (valid 1 month, any style) or their money back. The studio is told
-- only when a refund is chosen. Admins can choose for the member (e.g. when asked at reception).

create table if not exists public.ticket_choices (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_cents int not null,
  class_title text not null,
  class_starts_at timestamptz not null,
  status text not null default 'waiting' check (status in ('waiting', 'credit', 'refund', 'refunded')),
  membership_id uuid references public.memberships(id) on delete set null,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ticket_choices_user on public.ticket_choices (user_id, created_at desc);
alter table public.ticket_choices enable row level security;
drop policy if exists ticket_choices_read on public.ticket_choices;
create policy ticket_choices_read on public.ticket_choices for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
grant select on public.ticket_choices to authenticated;

alter table public.app_settings add column if not exists ticket_credit_days int not null default 30 check (ticket_credit_days between 7 and 365);

create or replace function public._offer_ticket_choice(b public.bookings, s public.class_sessions, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pay public.payments;
  c public.ticket_choices;
begin
  select * into pay from public.payments where id = b.payment_id;
  if not found or pay.status <> 'succeeded' or pay.amount_cents <= 0 then return; end if;
  insert into public.ticket_choices (booking_id, payment_id, user_id, amount_cents, class_title, class_starts_at)
  values (b.id, pay.id, b.user_id, pay.amount_cents, s.title, s.starts_at)
  on conflict (booking_id) do nothing returning * into c;
  if c.id is null then return; end if;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (b.user_id, 'ticket_choice', jsonb_build_object('choice_id', c.id, 'title', s.title, 'starts_at', s.starts_at,
    'amount_cents', pay.amount_cents, 'credit_days', (select ticket_credit_days from public.app_settings limit 1), 'reason', p_reason),
    'ticket_choice:' || c.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit('ticket_choice_offered', 'payment', pay.id::text,
    jsonb_build_object('reason', p_reason, 'booking_id', b.id, 'user_id', b.user_id, 'choice_id', c.id));
end;
$$;

create or replace function public._cancel_booking(
  p_booking_id uuid,
  p_by_admin boolean,
  p_reason text,
  p_force_restore boolean,
  p_refund_kind public.ledger_kind default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
  v_session_id uuid;
  s public.class_sessions;
  b public.bookings;
  v_late boolean;
  v_restore boolean;
  v_status public.booking_status;
  v_remaining int;
  v_kind public.ledger_kind;
begin
  select session_id into v_session_id from public.bookings where id = p_booking_id;
  if not found then perform public._fail('booking_not_found'); end if;

  select * into s from public.class_sessions where id = v_session_id for update;
  select * into b from public.bookings where id = p_booking_id;
  if b.membership_id is not null then
    perform 1 from public.memberships where id = b.membership_id for update;
  end if;
  select * into b from public.bookings where id = p_booking_id for update;

  if b.status not in ('booked', 'pending_payment') then perform public._fail('booking_not_active'); end if;

  -- Abandoning an unpaid ticket hold.
  if b.status = 'pending_payment' then
    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
        cancel_reason = coalesce(p_reason, 'Checkout abandoned'), hold_expires_at = null
    where id = b.id;
    update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = s.id;
    update public.payments set status = 'cancelled' where id = b.payment_id and status = 'pending';
    return jsonb_build_object('status', 'cancelled', 'class_restored', false, 'late', false);
  end if;

  if not p_by_admin and s.starts_at <= now() then perform public._fail('session_started'); end if;

  v_late := now() > s.starts_at - make_interval(mins => cfg.cancellation_cutoff_minutes);
  v_restore := b.membership_id is not null
    and (p_force_restore or not v_late or cfg.late_cancel_restores_class);
  v_status := case when v_late and not p_by_admin then 'late_cancelled' else 'cancelled' end;

  update public.bookings
  set status = v_status, class_restored = v_restore, cancelled_at = now(),
      cancelled_by = auth.uid(), cancel_reason = p_reason
  where id = b.id;

  update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = s.id;

  if v_restore then
    v_kind := coalesce(p_refund_kind, case when v_late then 'late_cancel_refund' else 'cancel_refund' end::public.ledger_kind);
    update public.memberships set classes_remaining = classes_remaining + 1
    where id = b.membership_id
    returning classes_remaining into v_remaining;
    insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id, reason)
    values (b.membership_id, b.user_id, 1, v_remaining, v_kind, b.id, auth.uid(), p_reason);
  end if;

  if b.payment_id is not null then
    -- Paid ticket or Drop In: the member chooses a class credit (valid 1 month) or a refund.
    perform public._offer_ticket_choice(b, s, p_reason);
  end if;

  if p_by_admin then
    perform public._audit('booking_cancelled', 'booking', b.id::text,
      jsonb_build_object('reason', p_reason, 'class_restored', v_restore, 'user_id', b.user_id));
  end if;

  return jsonb_build_object('status', v_status, 'class_restored', v_restore, 'late', v_late);
end;
$$;

-- Applies the choice (member or admin).
create or replace function public._decide_ticket_choice(p_id uuid, p_credit boolean, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c public.ticket_choices;
  pay public.payments; snap jsonb; mid uuid;
  v_days int := (select ticket_credit_days from public.app_settings limit 1);
  pl uuid := (select id from public.membership_plans where code = 'intro-3');
begin
  select * into c from public.ticket_choices where id = p_id for update;
  if not found then perform public._fail('choice_not_found'); end if;
  if c.status <> 'waiting' then perform public._fail('choice_already_made'); end if;
  if p_credit then
    snap := jsonb_build_object('plan_id', pl, 'plan_code', 'class-credit', 'plan_name', 'Class credit',
      'class_count', 1, 'validity_days', v_days, 'style_access', 'multi', 'billing_interval', 'one_off',
      'allowed_style_ids', (select coalesce(jsonb_agg(id), '[]') from public.dance_styles where is_active),
      'excluded_template_ids', '[]'::jsonb, 'selected_style_id', null);
    insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, idempotency_key, kind, status, completed_at)
    values (c.user_id, pl, snap, 0, 'EUR', 'manual', false, 'ticket-credit:' || c.id, 'membership', 'succeeded', now()) returning * into pay;
    mid := public._grant_membership(c.user_id, pay, snap, 1, now() + make_interval(days => v_days), null, 'grant_purchase',
      'Credit for cancelled ' || c.class_title || ' (' || to_char(c.class_starts_at at time zone 'Europe/Dublin', 'DD Mon') || ')', 'Class credit');
    update public.ticket_choices set status = 'credit', membership_id = mid, decided_by = p_by, decided_at = now() where id = c.id;
    perform public._audit('ticket_credit_given', 'payment', c.payment_id::text, jsonb_build_object('choice_id', c.id, 'membership_id', mid, 'user_id', c.user_id));
    return jsonb_build_object('choice', 'credit', 'membership_id', mid, 'expires_at', now() + make_interval(days => v_days));
  end if;
  update public.ticket_choices set status = 'refund', decided_by = p_by, decided_at = now() where id = c.id;
  -- The studio refunds it in Square (Admin -> member -> Payments -> Refund).
  perform public._audit('ticket_refund_required', 'payment', c.payment_id::text,
    jsonb_build_object('booking_id', c.booking_id, 'user_id', c.user_id, 'choice_id', c.id));
  perform public._assistant_notify_owner('ticket_refund_requested', jsonb_build_object('choice_id', c.id, 'user_id', c.user_id,
    'member', (select full_name from public.profiles where id = c.user_id), 'title', c.class_title, 'starts_at', c.class_starts_at,
    'amount_cents', c.amount_cents), 'ticket_refund:' || c.id);
  return jsonb_build_object('choice', 'refund');
end;
$$;

create or replace function public.choose_ticket_credit_or_refund(p_choice_id uuid, p_credit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.ticket_choices where id = p_choice_id and user_id = auth.uid()) then perform public._fail('choice_not_found'); end if;
  return public._decide_ticket_choice(p_choice_id, p_credit, auth.uid());
end;
$$;

create or replace function public.admin_ticket_choice(p_choice_id uuid, p_credit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return public._decide_ticket_choice(p_choice_id, p_credit, auth.uid());
end;
$$;

-- When the studio has refunded it in Square.
create or replace function public.admin_mark_ticket_refunded(p_choice_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  update public.ticket_choices set status = 'refunded' where id = p_choice_id and status = 'refund';
  perform public._audit('ticket_refunded', 'ticket_choice', p_choice_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public._offer_ticket_choice(public.bookings, public.class_sessions, text), public._decide_ticket_choice(uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.choose_ticket_credit_or_refund(uuid, boolean), public.admin_ticket_choice(uuid, boolean), public.admin_mark_ticket_refunded(uuid) from public, anon;
grant execute on function public.choose_ticket_credit_or_refund(uuid, boolean), public.admin_ticket_choice(uuid, boolean), public.admin_mark_ticket_refunded(uuid) to authenticated;
