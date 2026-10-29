-- Drop Studios — server-side business rules
-- All functions that change bookings, allowances, memberships or payments are
-- SECURITY DEFINER, lock the rows they touch, and raise short machine-readable
-- error codes (e.g. 'session_full') that the app maps to friendly messages.
--
-- Lock order (to avoid deadlocks): class_sessions -> memberships -> bookings.

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public._fail(p_code text, p_detail text default null)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function public._settings()
returns public.app_settings
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from public.app_settings where id;
$$;

create or replace function public._local_date(p_ts timestamptz)
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (p_ts at time zone (select timezone from public.app_settings where id))::date;
$$;

create or replace function public._local_today()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._local_date(now());
$$;

-- Expiry rule (mirrored in src/domain/membership.ts):
-- a pack is valid through the end of local day (activation date + validity days
-- + paused days); expires_at is the local midnight that ends that day.
create or replace function public.compute_expiry(p_activated_at timestamptz, p_validity_days int, p_pause_days int default 0)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ((public._local_date(p_activated_at) + p_validity_days + coalesce(p_pause_days, 0) + 1)::timestamp
          at time zone (select timezone from public.app_settings where id));
$$;

create or replace function public._pause_days(p_membership_id uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(ends_on - starts_on + 1), 0)::int
  from public.membership_pauses
  where membership_id = p_membership_id and not is_cancelled;
$$;

create or replace function public._is_paused_on(p_membership_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.membership_pauses
    where membership_id = p_membership_id and not is_cancelled
      and p_day between starts_on and ends_on
  );
$$;

create or replace function public._recompute_expiry(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_validity int;
begin
  select p.validity_days into v_validity
  from public.memberships m join public.membership_purchases p on p.id = m.purchase_id
  where m.id = p_membership_id;

  update public.memberships m
  set base_expires_at = public.compute_expiry(m.activated_at, v_validity, 0),
      expires_at = public.compute_expiry(m.activated_at, v_validity, public._pause_days(m.id))
  where m.id = p_membership_id and m.activated_at is not null;
end;
$$;

create or replace function public._audit(p_action text, p_entity_type text, p_entity_id text, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_details, '{}'));
$$;

-- Customer-facing status, exposed to PostgREST as a computed column:
--   memberships?select=*,state
create or replace function public.state(m public.memberships)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when m.admin_status = 'cancelled' then 'cancelled'
    when m.activated_at is not null and m.expires_at <= now() then 'expired'
    when m.activated_at is not null and public._is_paused_on(m.id, public._local_today()) then 'paused'
    when m.classes_remaining <= 0 then 'used_up'
    when m.activated_at is null then 'pending_activation'
    else 'active'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility
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
    where user_id = p_user_id and session_id = s.id and status in ('booked', 'attended', 'no_show')
  ) then return 'already_booked'; end if;
  if s.booked_count >= s.capacity then return 'session_full'; end if;
  return null;
end;
$$;

create or replace function public._membership_issue(m public.memberships, s public.class_sessions)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pur public.membership_purchases;
  v_expiry timestamptz;
begin
  select * into pur from public.membership_purchases where id = m.purchase_id;

  if m.admin_status = 'cancelled' then return 'membership_cancelled'; end if;
  if m.activated_at is not null and m.expires_at <= now() then return 'membership_expired'; end if;
  if m.classes_remaining <= 0 then return 'no_classes_left'; end if;

  -- A pack activated by its first booking would start now.
  v_expiry := coalesce(m.expires_at, public.compute_expiry(now(), pur.validity_days, 0));
  if s.starts_at >= v_expiry then return 'class_after_expiry'; end if;

  if public._is_paused_on(m.id, public._local_today()) then return 'membership_paused'; end if;
  if public._is_paused_on(m.id, public._local_date(s.starts_at)) then return 'class_in_pause'; end if;

  if s.is_special then return 'special_event'; end if;
  if not (s.style_id = any (pur.allowed_style_ids)) then return 'style_not_included'; end if;

  if s.template_id = any (pur.excluded_template_ids)
     or exists (select 1 from public.plan_exclusions e where e.plan_id = pur.plan_id and e.session_id = s.id)
     -- Exclusions of recurring classes added after purchase only apply to
     -- classes that did not exist at purchase time (terms are preserved).
     or exists (
       select 1 from public.plan_exclusions e
       join public.class_templates t on t.id = e.template_id
       where e.plan_id = pur.plan_id and e.template_id = s.template_id
         and t.created_at > pur.purchased_at
     )
  then return 'class_excluded'; end if;

  return null;
end;
$$;

-- What can the current user do with this class? Used by the booking sheet to
-- explain refusals and propose alternatives. Read-only.
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
  v_my_booking uuid;
begin
  select * into s from public.class_sessions where id = p_session_id;
  if not found then perform public._fail('session_not_found'); end if;

  v_session_issue := public._session_issue(s, v_uid);

  if v_uid is null then
    return jsonb_build_object('authenticated', false, 'session_issue', v_session_issue);
  end if;

  select id into v_my_booking from public.bookings
  where user_id = v_uid and session_id = s.id and status = 'booked';

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

  if v_session_issue is not null or v_eligible is null then
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
    'my_booking_id', v_my_booking,
    'eligible_membership_id', v_eligible,
    'memberships', v_options,
    'alternatives', v_alts,
    'cancellation_cutoff_minutes', cfg.cancellation_cutoff_minutes,
    'late_cancel_restores_class', cfg.late_cancel_restores_class
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Booking and cancellation
-- ---------------------------------------------------------------------------
create or replace function public.book_class(p_session_id uuid, p_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
  m public.memberships;
  cand public.memberships;
  v_issue text;
  v_live_issue text;
  v_dead_issue text;
  v_booking_id uuid;
  v_remaining int;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;

  v_issue := public._session_issue(s, v_uid);
  if v_issue is not null then perform public._fail(v_issue); end if;

  if p_membership_id is not null then
    select * into m from public.memberships
    where id = p_membership_id and user_id = v_uid for update;
    if not found then perform public._fail('membership_not_found'); end if;
    v_issue := public._membership_issue(m, s);
    if v_issue is not null then perform public._fail(v_issue); end if;
  else
    -- Use the pack that expires soonest; packs awaiting activation go last.
    for cand in
      select * from public.memberships
      where user_id = v_uid
      order by (activated_at is null), expires_at, created_at
      for update
    loop
      v_issue := public._membership_issue(cand, s);
      if v_issue is null then
        m := cand;
        exit;
      elsif v_issue in ('membership_expired', 'no_classes_left', 'membership_cancelled') then
        v_dead_issue := coalesce(v_dead_issue, v_issue);
      else
        v_live_issue := coalesce(v_live_issue, v_issue);
      end if;
    end loop;
    if m.id is null then
      perform public._fail(coalesce(v_live_issue, v_dead_issue, 'no_membership'));
    end if;
  end if;

  if m.activated_at is null then
    update public.memberships mm
    set activated_at = now(),
        base_expires_at = public.compute_expiry(now(), pu.validity_days, 0),
        expires_at = public.compute_expiry(now(), pu.validity_days, 0)
    from public.membership_purchases pu
    where mm.id = m.id and pu.id = mm.purchase_id;
  end if;

  begin
    insert into public.bookings (user_id, session_id, membership_id)
    values (v_uid, s.id, m.id)
    returning id into v_booking_id;
  exception when unique_violation then
    perform public._fail('already_booked');
  end;

  update public.memberships set classes_remaining = classes_remaining - 1
  where id = m.id
  returning classes_remaining into v_remaining;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id)
  values (m.id, v_uid, -1, v_remaining, 'booking', v_booking_id, v_uid);

  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'membership_id', m.id,
    'classes_remaining', v_remaining
  );
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

  if b.status <> 'booked' then perform public._fail('booking_not_active'); end if;
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
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if not exists (select 1 from public.bookings where id = p_booking_id and user_id = auth.uid()) then
    perform public._fail('booking_not_found');
  end if;
  return public._cancel_booking(p_booking_id, false, null, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchases
-- ---------------------------------------------------------------------------
create or replace function public.is_first_time_customer(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.membership_purchases
    where user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public._plan_snapshot(p_user_id uuid, p_plan_id uuid, p_style_id uuid, p_check_first_time boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  p public.membership_plans;
  v_allowed uuid[];
begin
  select * into p from public.membership_plans where id = p_plan_id and is_active;
  if not found then perform public._fail('plan_unavailable'); end if;

  if p_check_first_time and p.first_time_only and not public.is_first_time_customer(p_user_id) then
    perform public._fail('intro_not_eligible');
  end if;

  if p.all_styles then
    select coalesce(array_agg(id order by sort_order), '{}') into v_allowed
    from public.dance_styles where is_active;
  else
    select coalesce(array_agg(ds.id order by ds.sort_order), '{}') into v_allowed
    from public.plan_styles ps join public.dance_styles ds on ds.id = ps.style_id
    where ps.plan_id = p.id and ds.is_active;
  end if;

  if p.style_access = 'single' then
    if p_style_id is null then perform public._fail('style_required'); end if;
    if not (p_style_id = any (v_allowed)) then perform public._fail('style_not_eligible'); end if;
    v_allowed := array[p_style_id];
  else
    p_style_id := null;
  end if;

  return jsonb_build_object(
    'plan_id', p.id,
    'plan_code', p.code,
    'plan_name', p.name,
    'price_cents', p.price_cents,
    'currency', p.currency,
    'class_count', p.class_count,
    'validity_days', p.validity_days,
    'style_access', p.style_access,
    'selected_style_id', p_style_id,
    'allowed_style_ids', to_jsonb(v_allowed),
    'excluded_template_ids', coalesce((
      select jsonb_agg(template_id) from public.plan_exclusions
      where plan_id = p.id and template_id is not null
    ), '[]'),
    'first_time_only', p.first_time_only
  );
end;
$$;

-- Called (with the customer's JWT) by the create-checkout / dev-checkout edge
-- functions. Price comes from the database, never the client.
create or replace function public.create_checkout(
  p_plan_id uuid,
  p_selected_style_id uuid,
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
  v_snap jsonb;
  pay public.payments;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_provider not in ('stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
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

create or replace function public._create_membership(pay public.payments)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
  snap jsonb := pay.plan_snapshot;
  v_purchase_id uuid;
  v_membership_id uuid;
  v_count int := (snap ->> 'class_count')::int;
begin
  insert into public.membership_purchases (
    user_id, payment_id, plan_id, plan_code, plan_name, price_cents, currency,
    class_count, validity_days, style_access, allowed_style_ids, excluded_template_ids,
    selected_style_id, first_time_only, activation_policy, cancellation_cutoff_minutes, is_test
  ) values (
    pay.user_id, pay.id, (snap ->> 'plan_id')::uuid, snap ->> 'plan_code', snap ->> 'plan_name',
    pay.amount_cents, pay.currency, v_count, (snap ->> 'validity_days')::int,
    (snap ->> 'style_access')::public.style_access,
    array(select jsonb_array_elements_text(snap -> 'allowed_style_ids')::uuid),
    array(select jsonb_array_elements_text(snap -> 'excluded_template_ids')::uuid),
    (snap ->> 'selected_style_id')::uuid, (snap ->> 'first_time_only')::boolean,
    cfg.activation_policy, cfg.cancellation_cutoff_minutes, pay.is_test
  ) returning id into v_purchase_id;

  insert into public.memberships (
    purchase_id, user_id, plan_name, style_access, selected_style_id,
    classes_total, classes_remaining, activated_at, expires_at, base_expires_at, is_test
  ) values (
    v_purchase_id, pay.user_id, snap ->> 'plan_name', (snap ->> 'style_access')::public.style_access,
    (snap ->> 'selected_style_id')::uuid, v_count, v_count,
    case when cfg.activation_policy = 'on_purchase' then now() end,
    case when cfg.activation_policy = 'on_purchase' then public.compute_expiry(now(), (snap ->> 'validity_days')::int, 0) end,
    case when cfg.activation_policy = 'on_purchase' then public.compute_expiry(now(), (snap ->> 'validity_days')::int, 0) end,
    pay.is_test
  ) returning id into v_membership_id;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
  values (v_membership_id, pay.user_id, v_count, v_count, 'grant_purchase', auth.uid(),
          'Payment ' || pay.id::text);

  perform public._audit('membership_created', 'membership', v_membership_id::text,
    jsonb_build_object('payment_id', pay.id, 'provider', pay.provider, 'is_test', pay.is_test,
                       'amount_cents', pay.amount_cents, 'user_id', pay.user_id));
  return v_membership_id;
end;
$$;

-- Service role only (Stripe webhook / dev checkout). Idempotent per payment.
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

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pauses
-- ---------------------------------------------------------------------------
create or replace function public.pause_allowance(p_user_id uuid default null, p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_year int := coalesce(p_year, extract(year from public._local_today())::int);
  v_used int;
  cfg public.app_settings := public._settings();
begin
  if v_uid <> auth.uid() and not public.is_admin() then perform public._fail('forbidden'); end if;
  select coalesce(sum(ends_on - starts_on + 1), 0) into v_used
  from public.membership_pauses
  where user_id = v_uid and not is_cancelled and extract(year from starts_on) = v_year;
  return jsonb_build_object(
    'year', v_year, 'used_days', v_used, 'max_days', cfg.max_pause_days_per_year,
    'remaining_days', greatest(cfg.max_pause_days_per_year - v_used, 0),
    'min_days', cfg.min_pause_days
  );
end;
$$;

create or replace function public.pause_membership(
  p_membership_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text default null,
  p_override_limits boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
  cfg public.app_settings := public._settings();
  m public.memberships;
  v_today date := public._local_today();
  v_days int;
  v_used int;
  v_pause_id uuid;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_override_limits and not v_admin then perform public._fail('forbidden'); end if;

  select * into m from public.memberships where id = p_membership_id for update;
  if not found or (m.user_id <> v_uid and not v_admin) then perform public._fail('membership_not_found'); end if;
  -- Serialise pauses per customer so the yearly limit can't be raced.
  perform 1 from public.profiles where id = m.user_id for update;

  if m.admin_status = 'cancelled' then perform public._fail('membership_cancelled'); end if;
  if m.activated_at is null then perform public._fail('membership_not_activated'); end if;
  if m.expires_at <= now() then perform public._fail('membership_expired'); end if;
  if m.classes_remaining <= 0 then perform public._fail('no_classes_left'); end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then perform public._fail('invalid_pause_dates'); end if;
  if p_starts_on < v_today then perform public._fail('pause_start_in_past'); end if;
  if p_starts_on >= public._local_date(m.expires_at) then perform public._fail('pause_after_expiry'); end if;

  v_days := p_ends_on - p_starts_on + 1;
  if not p_override_limits and v_days < cfg.min_pause_days then
    perform public._fail('pause_too_short', cfg.min_pause_days::text);
  end if;

  if exists (
    select 1 from public.membership_pauses
    where membership_id = m.id and not is_cancelled and ends_on >= v_today
  ) then perform public._fail('pause_already_scheduled'); end if;

  select coalesce(sum(ends_on - starts_on + 1), 0) into v_used
  from public.membership_pauses
  where user_id = m.user_id and not is_cancelled
    and extract(year from starts_on) = extract(year from p_starts_on);
  if not p_override_limits and v_used + v_days > cfg.max_pause_days_per_year then
    perform public._fail('pause_limit_exceeded', greatest(cfg.max_pause_days_per_year - v_used, 0)::text);
  end if;

  if exists (
    select 1 from public.bookings b join public.class_sessions s on s.id = b.session_id
    where b.membership_id = m.id and b.status = 'booked'
      and public._local_date(s.starts_at) between p_starts_on and p_ends_on
  ) then perform public._fail('bookings_during_pause'); end if;

  insert into public.membership_pauses (membership_id, user_id, starts_on, ends_on, original_ends_on, reason, created_by)
  values (m.id, m.user_id, p_starts_on, p_ends_on, p_ends_on, p_reason, v_uid)
  returning id into v_pause_id;

  perform public._recompute_expiry(m.id);
  perform public._audit('membership_paused', 'membership', m.id::text,
    jsonb_build_object('pause_id', v_pause_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on,
                       'days', v_days, 'reason', p_reason, 'by_admin', v_admin and m.user_id <> v_uid,
                       'override_limits', p_override_limits));

  return jsonb_build_object(
    'pause_id', v_pause_id,
    'expires_at', (select expires_at from public.memberships where id = m.id)
  );
end;
$$;

create or replace function public.resume_membership(p_membership_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_admin boolean := public.is_admin();
  m public.memberships;
  pz public.membership_pauses;
  v_today date := public._local_today();
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into m from public.memberships where id = p_membership_id for update;
  if not found or (m.user_id <> v_uid and not v_admin) then perform public._fail('membership_not_found'); end if;

  select * into pz from public.membership_pauses
  where membership_id = m.id and not is_cancelled and ends_on >= v_today
  order by starts_on
  limit 1
  for update;
  if not found then perform public._fail('no_active_pause'); end if;

  if pz.starts_on >= v_today then
    -- Not started yet (or started today): remove it entirely.
    update public.membership_pauses set is_cancelled = true where id = pz.id;
  else
    update public.membership_pauses set ends_on = v_today - 1 where id = pz.id;
  end if;

  perform public._recompute_expiry(m.id);
  perform public._audit('membership_resumed', 'membership', m.id::text,
    jsonb_build_object('pause_id', pz.id, 'reason', p_reason, 'by_admin', v_admin and m.user_id <> v_uid));

  return jsonb_build_object('expires_at', (select expires_at from public.memberships where id = m.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Timetable generation
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
    capacity, level, room, is_special
  )
  select t.id, t.title, t.style_id, t.instructor_id,
         ((d::date + t.start_time)::timestamp at time zone v_tz),
         ((d::date + t.start_time)::timestamp at time zone v_tz) + make_interval(mins => t.duration_minutes),
         t.capacity, t.level, t.room, t.is_special
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

-- ---------------------------------------------------------------------------
-- Administration
-- ---------------------------------------------------------------------------
create or replace function public._require_admin()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then perform public._fail('forbidden'); end if;
end;
$$;

create or replace function public.admin_generate_sessions(p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  perform public._require_admin();
  if p_to < p_from or p_to - p_from > 120 then perform public._fail('invalid_date_range'); end if;
  v_count := public.generate_sessions(p_from, p_to);
  perform public._audit('sessions_generated', 'class_sessions', null,
    jsonb_build_object('from', p_from, 'to', p_to, 'created', v_count));
  return v_count;
end;
$$;

-- Push template edits (not times) to future sessions that came from it.
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
      is_special = t.is_special
  from public.class_templates t
  where t.id = p_template_id and s.template_id = t.id
    and s.starts_at > now() and s.status = 'scheduled';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.admin_adjust_classes(p_membership_id uuid, p_delta int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.memberships;
  v_remaining int;
begin
  perform public._require_admin();
  if p_delta is null or p_delta = 0 then perform public._fail('invalid_amount'); end if;
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;

  select * into m from public.memberships where id = p_membership_id for update;
  if not found then perform public._fail('membership_not_found'); end if;
  if m.classes_remaining + p_delta < 0 then perform public._fail('insufficient_classes'); end if;

  update public.memberships
  set classes_remaining = classes_remaining + p_delta,
      classes_total = classes_total + greatest(p_delta, 0)
  where id = m.id
  returning classes_remaining into v_remaining;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
  values (m.id, m.user_id, p_delta, v_remaining,
          case when p_delta > 0 then 'admin_grant' else 'admin_revoke' end::public.ledger_kind,
          auth.uid(), p_reason);

  perform public._audit(case when p_delta > 0 then 'classes_granted' else 'classes_revoked' end,
    'membership', m.id::text,
    jsonb_build_object('delta', p_delta, 'reason', p_reason, 'balance_after', v_remaining, 'user_id', m.user_id));
  return jsonb_build_object('classes_remaining', v_remaining);
end;
$$;

create or replace function public.admin_cancel_booking(p_booking_id uuid, p_reason text, p_restore boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  return public._cancel_booking(p_booking_id, true, p_reason, p_restore);
end;
$$;

create or replace function public.admin_cancel_session(p_session_id uuid, p_reason text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  v_booking uuid;
  v_count int := 0;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;
  if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;

  for v_booking in select id from public.bookings where session_id = s.id and status = 'booked' loop
    perform public._cancel_booking(v_booking, true, p_reason, true, 'session_cancelled_refund');
    v_count := v_count + 1;
  end loop;

  update public.class_sessions set status = 'cancelled', cancel_reason = p_reason where id = s.id;
  return v_count;
end;
$$;

create or replace function public.admin_set_attendance(p_booking_id uuid, p_status public.booking_status)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
  b public.bookings;
  s public.class_sessions;
  v_remaining int;
  v_restored boolean;
begin
  if not public.is_staff() then perform public._fail('forbidden'); end if;
  if p_status not in ('attended', 'no_show', 'booked') then perform public._fail('invalid_status'); end if;

  select * into b from public.bookings where id = p_booking_id;
  if not found then perform public._fail('booking_not_found'); end if;
  select * into s from public.class_sessions where id = b.session_id for update;
  if b.membership_id is not null then
    perform 1 from public.memberships where id = b.membership_id for update;
  end if;
  select * into b from public.bookings where id = p_booking_id for update;

  if b.status not in ('booked', 'attended', 'no_show') then perform public._fail('booking_not_active'); end if;
  if s.starts_at > now() + interval '1 hour' then perform public._fail('session_not_started'); end if;

  v_restored := b.class_restored;
  -- Keep the allowance consistent with the no-show policy when status flips.
  if b.membership_id is not null then
    if p_status = 'no_show' and cfg.no_show_restores_class and not b.class_restored then
      update public.memberships set classes_remaining = classes_remaining + 1
      where id = b.membership_id returning classes_remaining into v_remaining;
      insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id)
      values (b.membership_id, b.user_id, 1, v_remaining, 'no_show_refund', b.id, auth.uid());
      v_restored := true;
    elsif p_status <> 'no_show' and b.class_restored then
      update public.memberships set classes_remaining = classes_remaining - 1
      where id = b.membership_id and classes_remaining > 0 returning classes_remaining into v_remaining;
      if found then
        insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id, reason)
        values (b.membership_id, b.user_id, -1, v_remaining, 'admin_revoke', b.id, auth.uid(), 'No-show reversed');
        v_restored := false;
      end if;
    end if;
  end if;

  update public.bookings
  set status = p_status, class_restored = v_restored,
      attendance_marked_at = now(), attendance_marked_by = auth.uid()
  where id = b.id;

  return jsonb_build_object('status', p_status, 'class_restored', v_restored);
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if p_user_id = auth.uid() and p_role <> 'admin' then perform public._fail('cannot_demote_self'); end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then perform public._fail('user_not_found'); end if;
  perform public._audit('role_changed', 'profile', p_user_id::text, jsonb_build_object('role', p_role));
end;
$$;

-- In-studio sale (cash / card terminal). Recorded as a real 'manual' payment.
create or replace function public.admin_record_manual_sale(
  p_user_id uuid,
  p_plan_id uuid,
  p_selected_style_id uuid,
  p_amount_cents int,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_snap jsonb;
  pay public.payments;
  v_membership_id uuid;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  if p_amount_cents is null or p_amount_cents < 0 then perform public._fail('invalid_amount'); end if;
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then perform public._fail('user_not_found'); end if;

  v_snap := public._plan_snapshot(p_user_id, p_plan_id, p_selected_style_id, false);
  v_snap := v_snap || jsonb_build_object('price_cents', p_amount_cents, 'list_price_cents', v_snap -> 'price_cents');

  insert into public.payments (
    user_id, plan_id, selected_style_id, plan_snapshot, amount_cents, currency, provider,
    is_test, status, idempotency_key, created_by, completed_at, provider_payment_ref
  ) values (
    p_user_id, p_plan_id, (v_snap ->> 'selected_style_id')::uuid, v_snap, p_amount_cents,
    v_snap ->> 'currency', 'manual', false, 'succeeded', 'manual-' || gen_random_uuid(),
    auth.uid(), now(), p_reason
  ) returning * into pay;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('payment_id', pay.id, 'membership_id', v_membership_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications (queued; delivery is a separate worker — see docs)
-- ---------------------------------------------------------------------------
create or replace function public.queue_expiry_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
  v_count int;
begin
  if not cfg.expiry_reminders_enabled then return 0; end if;
  with due as (
    update public.memberships m
    set last_expiry_reminder_at = now()
    where m.admin_status = 'valid' and m.activated_at is not null
      and m.expires_at > now()
      and m.expires_at <= now() + make_interval(days => cfg.expiry_reminder_days)
      and m.classes_remaining > 0
      and m.last_expiry_reminder_at is null
    returning m.*
  )
  insert into public.notification_outbox (user_id, kind, payload)
  select user_id, 'membership_expiring',
         jsonb_build_object('membership_id', id, 'plan_name', plan_name,
                            'expires_at', expires_at, 'classes_remaining', classes_remaining)
  from due;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin(), public.is_staff() to anon, authenticated;
grant execute on function public.state(public.memberships) to authenticated;
grant execute on function public.booking_options(uuid) to anon, authenticated;
grant execute on function public.book_class(uuid, uuid) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.is_first_time_customer(uuid) to authenticated;
grant execute on function public.create_checkout(uuid, uuid, text, public.payment_provider) to authenticated;
grant execute on function public.pause_allowance(uuid, int) to authenticated;
grant execute on function public.pause_membership(uuid, date, date, text, boolean) to authenticated;
grant execute on function public.resume_membership(uuid, text) to authenticated;
grant execute on function public.admin_generate_sessions(date, date) to authenticated;
grant execute on function public.admin_apply_template_to_future(uuid) to authenticated;
grant execute on function public.admin_adjust_classes(uuid, int, text) to authenticated;
grant execute on function public.admin_cancel_booking(uuid, text, boolean) to authenticated;
grant execute on function public.admin_cancel_session(uuid, text) to authenticated;
grant execute on function public.admin_set_attendance(uuid, public.booking_status) to authenticated;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;
grant execute on function public.admin_record_manual_sale(uuid, uuid, uuid, int, text) to authenticated;

-- Server-only entry points
grant execute on function public.fulfill_payment(uuid, public.payment_provider, text, text, int, text) to service_role;
grant execute on function public.generate_sessions(date, date) to service_role;
grant execute on function public.queue_expiry_reminders() to service_role;

-- New functions should not be callable by clients unless granted explicitly.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
