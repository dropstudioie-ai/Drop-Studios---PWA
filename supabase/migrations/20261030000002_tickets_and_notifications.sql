-- Drop Studios — workshop tickets and notification delivery.
--
-- Tickets: special sessions (is_special) can carry a ticket price. Starting a
-- ticket checkout holds a spot (booking status 'pending_payment') for 35
-- minutes so a workshop can't be oversold while customers are paying. The
-- Stripe webhook confirms the hold; expired or abandoned checkouts release it.
--
-- Notifications: rows in notification_outbox are claimed and delivered by the
-- send-notifications edge function (email and/or web push).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
create type public.payment_kind as enum ('membership', 'ticket');

alter table public.class_templates
  add column ticket_price_cents int check (ticket_price_cents >= 0);
alter table public.class_sessions
  add column ticket_price_cents int check (ticket_price_cents >= 0);
grant update (ticket_price_cents) on public.class_sessions to authenticated;

alter table public.payments
  add column kind public.payment_kind not null default 'membership',
  add column session_id uuid references public.class_sessions (id),
  add column booking_id uuid references public.bookings (id),
  alter column plan_id drop not null,
  add constraint payments_kind_target check (
    (kind = 'membership' and plan_id is not null and session_id is null)
    or (kind = 'ticket' and session_id is not null and plan_id is null)
  );

alter table public.bookings
  add column hold_expires_at timestamptz,
  add column payment_id uuid references public.payments (id);
create index bookings_pending_idx on public.bookings (hold_expires_at) where status = 'pending_payment';

drop index public.bookings_one_live_per_session;
create unique index bookings_one_live_per_session
  on public.bookings (user_id, session_id)
  where status in ('booked', 'attended', 'no_show', 'pending_payment');

alter table public.notification_outbox
  add column attempts int not null default 0,
  add column claimed_at timestamptz;
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where sent_at is null;

-- class_sessions audit trigger lists columns explicitly; include the new one.
drop trigger class_sessions_audit on public.class_sessions;
create trigger class_sessions_audit
  after insert or delete or update of title, style_id, instructor_id, starts_at, ends_at,
    capacity, level, room, is_special, status, cancel_reason, ticket_price_cents
  on public.class_sessions
  for each row execute function public.audit_config_change();

-- ---------------------------------------------------------------------------
-- Holds
-- ---------------------------------------------------------------------------
-- Releases unpaid ticket holds. Caller must already hold the session lock when
-- p_session_id is given; the global variant (cron) locks each session itself.
create or replace function public.release_expired_holds(p_session_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select b.id, b.session_id, b.payment_id from public.bookings b
    where b.status = 'pending_payment' and b.hold_expires_at < now()
      and (p_session_id is null or b.session_id = p_session_id)
    order by b.session_id
  loop
    perform 1 from public.class_sessions where id = r.session_id for update;
    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed', hold_expires_at = null
    where id = r.id and status = 'pending_payment';
    if found then
      update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = r.session_id;
      update public.payments set status = 'cancelled' where id = r.payment_id and status = 'pending';
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Session checks now count holds as live bookings
-- ---------------------------------------------------------------------------
create or replace function public._session_issue(s public.class_sessions, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
begin
  if s.status = 'cancelled' then return 'session_cancelled'; end if;
  if s.starts_at <= now() then return 'session_started'; end if;
  if s.starts_at > now() + make_interval(days => cfg.booking_window_days) then return 'outside_booking_window'; end if;
  if p_user_id is not null and exists (
    select 1 from public.bookings
    where user_id = p_user_id and session_id = s.id and status in ('booked', 'attended', 'no_show', 'pending_payment')
  ) then return 'already_booked'; end if;
  if s.booked_count >= s.capacity then return 'session_full'; end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ticket checkout
-- ---------------------------------------------------------------------------
create or replace function public.create_ticket_checkout(
  p_session_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'stripe'
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
  if p_provider not in ('stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
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

-- Confirms a paid ticket. If the hold had already lapsed, re-books when a spot
-- is still free; otherwise flags the payment for a refund.
create or replace function public._confirm_ticket(pay public.payments)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  b public.bookings;
begin
  select * into s from public.class_sessions where id = pay.session_id for update;
  select * into b from public.bookings where id = pay.booking_id for update;

  if b.status = 'pending_payment' then
    update public.bookings set status = 'booked', hold_expires_at = null where id = b.id;
  elsif b.status <> 'booked' then
    if s.status = 'cancelled' or s.starts_at <= now() or s.booked_count >= s.capacity then
      perform public._audit('ticket_refund_required', 'payment', pay.id::text,
        jsonb_build_object('reason', 'hold expired and no spot available', 'user_id', pay.user_id, 'session_id', s.id));
      return jsonb_build_object('ok', true, 'booking_id', null, 'refund_required', true);
    end if;
    begin
      update public.bookings
      set status = 'booked', hold_expires_at = null, cancelled_at = null, cancel_reason = null
      where id = b.id;
    exception when unique_violation then
      perform public._audit('ticket_refund_required', 'payment', pay.id::text,
        jsonb_build_object('reason', 'customer already holds a booking for this class', 'user_id', pay.user_id));
      return jsonb_build_object('ok', true, 'booking_id', null, 'refund_required', true);
    end;
    update public.class_sessions set booked_count = booked_count + 1 where id = s.id;
  end if;

  perform public._audit('ticket_sold', 'booking', b.id::text,
    jsonb_build_object('payment_id', pay.id, 'amount_cents', pay.amount_cents, 'is_test', pay.is_test, 'user_id', pay.user_id));
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'refund_required', false);
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
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;

  if pay.status = 'succeeded' then
    if pay.kind = 'ticket' then
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

  update public.payments
  set status = 'succeeded', completed_at = now(), provider_payment_ref = p_provider_ref,
      provider_event_id = p_provider_event_id, failure_reason = null
  where id = pay.id
  returning * into pay;

  if pay.kind = 'ticket' then
    return public._confirm_ticket(pay) || jsonb_build_object('duplicate', false);
  end if;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$$;

-- Stripe session expired or failed: release any held spot (service role only).
create or replace function public.expire_payment(p_payment_id uuid, p_status public.payment_status, p_provider_session_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
  v_session uuid;
begin
  if p_status not in ('cancelled', 'failed') then perform public._fail('invalid_status'); end if;
  select session_id into v_session from public.payments where id = p_payment_id;
  if v_session is not null then
    perform 1 from public.class_sessions where id = v_session for update;
  end if;
  select * into pay from public.payments where id = p_payment_id for update;
  if not found or pay.status <> 'pending' or pay.provider_session_id is distinct from p_provider_session_id then
    return;
  end if;
  update public.payments set status = p_status where id = pay.id;
  if pay.booking_id is not null then
    update public.bookings
    set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Payment not completed', hold_expires_at = null
    where id = pay.booking_id and status = 'pending_payment';
    if found then
      update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = pay.session_id;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation: holds can be abandoned; paid tickets go through the studio
-- ---------------------------------------------------------------------------
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
    -- Paid ticket: money is refunded in Stripe by the studio.
    perform public._audit('ticket_refund_required', 'payment', b.payment_id::text,
      jsonb_build_object('reason', p_reason, 'booking_id', b.id, 'user_id', b.user_id));
  end if;

  if p_by_admin then
    perform public._audit('booking_cancelled', 'booking', b.id::text,
      jsonb_build_object('reason', p_reason, 'class_restored', v_restore, 'user_id', b.user_id));
  end if;

  return jsonb_build_object('status', v_status, 'class_restored', v_restore, 'late', v_late);
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.bookings;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into b from public.bookings where id = p_booking_id and user_id = auth.uid();
  if not found then perform public._fail('booking_not_found'); end if;
  if b.payment_id is not null and b.status = 'booked' then perform public._fail('ticket_contact_studio'); end if;
  return public._cancel_booking(p_booking_id, false, null, false);
end;
$$;

-- Studio cancels a class: refund classes, flag ticket refunds, notify everyone.
create or replace function public.admin_cancel_session(p_session_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  b public.bookings;
  v_count int := 0;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;
  if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;

  for b in select * from public.bookings where session_id = s.id and status in ('booked', 'pending_payment') loop
    perform public._cancel_booking(b.id, true, p_reason, true, 'session_cancelled_refund');
    if b.status = 'booked' then
      insert into public.notification_outbox (user_id, kind, payload)
      values (b.user_id, 'class_cancelled', jsonb_build_object(
        'title', s.title, 'starts_at', s.starts_at, 'reason', p_reason,
        'class_returned', b.membership_id is not null, 'ticket_refund', b.payment_id is not null));
      v_count := v_count + 1;
    end if;
  end loop;

  update public.class_sessions set status = 'cancelled', cancel_reason = p_reason where id = s.id;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking sheet: ticket information
-- ---------------------------------------------------------------------------
create or replace function public.booking_options(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  cfg public.app_settings := public._settings();
  s public.class_sessions;
  m public.memberships;
  v_issue text;
  v_session_issue text;
  v_options jsonb := '[]';
  v_eligible uuid;
  v_alts jsonb := '[]';
  alt public.class_sessions;
  v_count int := 0;
  mine public.bookings;
begin
  select * into s from public.class_sessions where id = p_session_id;
  if not found then perform public._fail('session_not_found'); end if;

  v_session_issue := public._session_issue(s, v_uid);

  if v_uid is null then
    return jsonb_build_object('authenticated', false, 'session_issue', v_session_issue,
      'ticket_price_cents', case when s.is_special then s.ticket_price_cents end);
  end if;

  select * into mine from public.bookings
  where user_id = v_uid and session_id = s.id and status in ('booked', 'pending_payment')
  order by booked_at desc limit 1;

  for m in
    select * from public.memberships
    where user_id = v_uid and admin_status = 'valid'
    order by (activated_at is null), expires_at, created_at
  loop
    v_issue := public._membership_issue(m, s);
    if v_issue is null and v_eligible is null then v_eligible := m.id; end if;
    v_options := v_options || jsonb_build_object(
      'membership_id', m.id, 'plan_name', m.plan_name, 'state', public.state(m),
      'classes_remaining', m.classes_remaining, 'issue', v_issue
    );
  end loop;

  if (v_session_issue is not null or v_eligible is null) and not s.is_special then
    for alt in
      select * from public.class_sessions c
      where c.id <> s.id and c.status = 'scheduled'
        and c.starts_at > now()
        and c.starts_at <= now() + make_interval(days => cfg.booking_window_days)
        and c.booked_count < c.capacity
      order by (c.style_id = s.style_id) desc, abs(extract(epoch from c.starts_at - s.starts_at))
      limit 60
    loop
      exit when v_count >= 4;
      if public._session_issue(alt, v_uid) is null and exists (
        select 1 from public.memberships mm
        where mm.user_id = v_uid and mm.admin_status = 'valid'
          and public._membership_issue(mm, alt) is null
      ) then
        v_alts := v_alts || jsonb_build_object(
          'id', alt.id, 'title', alt.title, 'starts_at', alt.starts_at,
          'spots_left', alt.capacity - alt.booked_count
        );
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'session_issue', v_session_issue,
    'my_booking_id', case when mine.status = 'booked' then mine.id end,
    'my_booking_is_ticket', mine.status = 'booked' and mine.payment_id is not null,
    'pending_hold_booking_id', case when mine.status = 'pending_payment' then mine.id end,
    'ticket_price_cents', case when s.is_special then s.ticket_price_cents end,
    'eligible_membership_id', v_eligible,
    'memberships', v_options,
    'alternatives', v_alts,
    'cancellation_cutoff_minutes', cfg.cancellation_cutoff_minutes,
    'late_cancel_restores_class', cfg.late_cancel_restores_class
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Timetable generation carries the ticket price
-- ---------------------------------------------------------------------------
create or replace function public.generate_sessions(p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := (public._settings()).timezone;
  v_count int;
begin
  insert into public.class_sessions (
    template_id, title, style_id, instructor_id, starts_at, ends_at,
    capacity, level, room, is_special, ticket_price_cents
  )
  select t.id, t.title, t.style_id, t.instructor_id,
         ((d::date + t.start_time)::timestamp at time zone v_tz),
         ((d::date + t.start_time)::timestamp at time zone v_tz) + make_interval(mins => t.duration_minutes),
         t.capacity, t.level, t.room, t.is_special, t.ticket_price_cents
  from public.class_templates t
  cross join generate_series(p_from, p_to, interval '1 day') d
  where t.is_active
    and extract(isodow from d) = t.weekday
    and d::date >= t.valid_from
    and (t.valid_until is null or d::date <= t.valid_until)
  on conflict (template_id, starts_at) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_apply_template_to_future(p_template_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  perform public._require_admin();
  update public.class_sessions s
  set title = t.title, style_id = t.style_id, instructor_id = t.instructor_id,
      capacity = greatest(t.capacity, s.booked_count), level = t.level, room = t.room,
      is_special = t.is_special, ticket_price_cents = t.ticket_price_cents
  from public.class_templates t
  where t.id = p_template_id and s.template_id = t.id
    and s.starts_at > now() and s.status = 'scheduled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification delivery (service role only)
-- ---------------------------------------------------------------------------
create or replace function public.claim_notifications(p_limit int default 50)
returns table (id bigint, user_id uuid, kind text, payload jsonb, email text, full_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select o.id from public.notification_outbox o
    where o.sent_at is null and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
    order by o.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
    set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.id, o.user_id, o.kind, o.payload
  )
  select c.id, c.user_id, c.kind, c.payload, p.email, p.full_name
  from claimed c join public.profiles p on p.id = c.user_id;
end;
$$;

create or replace function public.complete_notification(p_id bigint, p_error text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.notification_outbox
  set sent_at = case when p_error is null then now() end,
      error = p_error,
      claimed_at = null
  where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Ticket reporting
-- ---------------------------------------------------------------------------
create or replace function public.admin_ticket_sales(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := (public._settings()).timezone;
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  perform public._require_admin();
  return (
    select jsonb_build_object(
      'tickets_sold', count(*),
      'ticket_revenue_cents', coalesce(sum(amount_cents), 0),
      'refunds_to_review', (
        select count(*) from public.audit_log
        where action = 'ticket_refund_required' and created_at >= v_start and created_at < v_end
      )
    )
    from public.payments
    where kind = 'ticket' and status = 'succeeded' and not is_test
      and completed_at >= v_start and completed_at < v_end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges and schedules
-- ---------------------------------------------------------------------------
revoke execute on function public.release_expired_holds(uuid), public.create_ticket_checkout(uuid, text, public.payment_provider),
  public._confirm_ticket(public.payments), public.expire_payment(uuid, public.payment_status, text),
  public.claim_notifications(int), public.complete_notification(bigint, text),
  public.admin_ticket_sales(date, date)
  from public, anon, authenticated;

grant execute on function public.create_ticket_checkout(uuid, text, public.payment_provider) to authenticated;
grant execute on function public.admin_ticket_sales(date, date) to authenticated;
grant execute on function public.release_expired_holds(uuid), public.expire_payment(uuid, public.payment_status, text),
  public.claim_notifications(int), public.complete_notification(bigint, text)
  to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-release-holds', '*/10 * * * *', $job$select public.release_expired_holds()$job$);
  end if;
end;
$$;
