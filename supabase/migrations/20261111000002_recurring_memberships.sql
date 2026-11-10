-- Drop Studios — monthly recurring memberships with a 3-month cycle.
--
-- Plans:     intro-3 stays a one-off pack. single-4, multi-5, multi-8 and
--            multi-12 become monthly memberships with a 3-month commitment that
--            renews for another 3 months unless cancelled.
-- Credits:   every paid billing month issues the plan's classes.
--            * No rollover (Single Style, Multi-Style, Committed): each month is
--              its own membership row valid until the next billing date; when
--              the next month is paid, the previous month's unused classes
--              expire (ledger 'period_expired').
--            * Rollover (All In): month 1 of a cycle opens one membership valid
--              to the end of the 3-month cycle; months 2 and 3 add their classes
--              to it ('grant_renewal'). A new cycle starts a fresh membership and
--              the old cycle's unused classes expire.
-- Billing:   Square charges the card monthly (subscription). Each paid month is
--            a payments row and a subscription_periods row; the unique
--            (subscription, period_index) makes credit issuing idempotent, so a
--            repeated webhook can never issue classes twice.
-- Square:    plan variations are created on demand by create-checkout and kept
--            in square_plan_variations (per Square environment and price).

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
alter table public.membership_plans
  add column billing_interval text not null default 'one_off' check (billing_interval in ('one_off', 'monthly')),
  add column commitment_months int check (commitment_months between 1 and 24),
  add column credit_rollover boolean not null default false,
  add column highlight text check (highlight in ('recommended', 'best_value')),
  add column cta_label text,
  add constraint plan_billing_shape check (
    (billing_interval = 'one_off' and commitment_months is null and not credit_rollover)
    or (billing_interval = 'monthly' and commitment_months is not null and not first_time_only)
  );

update public.membership_plans set
  name = '3-Class Intro Offer', display_label = 'Intro Offer', highlight = null,
  short_description = 'Your first taste of the Drop Studios experience. Try different dance styles, meet our community and discover your rhythm.',
  cta_label = 'Start your Drop experience'
where code = 'intro-3';

update public.membership_plans set
  name = 'Single Style', display_label = null, highlight = null, billing_interval = 'monthly', commitment_months = 3,
  credit_rollover = false, validity_days = 30,
  short_description = 'For dancers who want to focus on one style and develop their skills.',
  cta_label = 'Choose Single Style'
where code = 'single-4';

update public.membership_plans set
  name = 'Multi-Style', display_label = null, highlight = null, billing_interval = 'monthly', commitment_months = 3,
  credit_rollover = false, validity_days = 30,
  short_description = 'Love variety? Explore different dance styles and discover something new every week.',
  cta_label = 'Choose Multi-Style'
where code = 'multi-5';

update public.membership_plans set
  name = 'Committed', display_label = 'Great for your weekly routine', highlight = 'recommended', billing_interval = 'monthly',
  commitment_months = 3, credit_rollover = false, validity_days = 30,
  short_description = 'Make dancing part of your weekly routine. More classes, more progress and more opportunities to move.',
  cta_label = 'Choose Committed'
where code = 'multi-8';

update public.membership_plans set
  name = 'All In', display_label = 'Best value', highlight = 'best_value', billing_interval = 'monthly',
  commitment_months = 3, credit_rollover = true, validity_days = 30,
  short_description = 'For those who can''t get enough of the dance floor. Enjoy more classes, more freedom, credit rollover and our best price per class.',
  cta_label = 'Choose All In'
where code = 'multi-12';

-- The purchase snapshot now records how the plan is billed.
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
    'first_time_only', p.first_time_only,
    'billing_interval', p.billing_interval,
    'commitment_months', p.commitment_months,
    'credit_rollover', p.credit_rollover
  );
end;
$$;

-- Checkout tells create-checkout whether to start a subscription.
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

    -- One monthly membership at a time (a second one would bill twice).
    if v_snap ->> 'billing_interval' = 'monthly' and exists (
      select 1 from public.member_subscriptions where user_id = v_uid and status in ('active', 'past_due', 'cancel_scheduled')
    ) then
      perform public._fail('already_subscribed');
    end if;

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
    'superseded', v_superseded,
    'plan_id', pay.plan_id,
    'billing_interval', coalesce(pay.plan_snapshot ->> 'billing_interval', 'one_off'),
    'commitment_months', (pay.plan_snapshot ->> 'commitment_months')::int
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscriptions and their billing months
-- ---------------------------------------------------------------------------
create table public.member_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  plan_id uuid not null references public.membership_plans (id),
  -- Terms agreed at checkout (price, monthly classes, rollover, commitment).
  plan_snapshot jsonb not null,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancel_scheduled', 'ended')),
  provider public.payment_provider not null,
  provider_subscription_id text unique,
  provider_customer_id text,
  initial_payment_id uuid not null unique references public.payments (id),
  -- Billing month n starts on anchor_date + n months (Dublin dates).
  anchor_date date not null,
  last_period_index int not null default -1,
  cancel_requested_at timestamptz,
  cancel_requested_by uuid references public.profiles (id),
  -- Last day covered: billing stops from this date (end of the 3-month cycle).
  cancel_effective_on date,
  -- When the cancellation was sent to Square (it then stops at the end of the
  -- current billing month).
  provider_cancel_sent_at timestamptz,
  ended_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index member_subscriptions_user_idx on public.member_subscriptions (user_id);
create trigger member_subscriptions_touch before update on public.member_subscriptions
  for each row execute function public.touch_updated_at();

create table public.subscription_periods (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.member_subscriptions (id) on delete restrict,
  period_index int not null check (period_index >= 0),
  cycle_no int not null,
  month_in_cycle int not null,
  starts_on date not null,
  ends_on date not null,   -- next billing date (exclusive)
  payment_id uuid not null unique references public.payments (id),
  membership_id uuid not null references public.memberships (id),
  credits_issued int not null check (credits_issued > 0),
  created_at timestamptz not null default now(),
  unique (subscription_id, period_index)
);

alter table public.memberships
  add column subscription_id uuid references public.member_subscriptions (id),
  add column subscription_cycle int;
create index memberships_subscription_idx on public.memberships (subscription_id) where subscription_id is not null;

-- Square catalog plan variations created by create-checkout (service role only).
create table public.square_plan_variations (
  plan_id uuid not null references public.membership_plans (id),
  environment text not null check (environment in ('sandbox', 'production')),
  price_cents int not null,
  plan_object_id text not null,
  variation_id text not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, environment, price_cents)
);

alter table public.member_subscriptions enable row level security;
alter table public.subscription_periods enable row level security;
alter table public.square_plan_variations enable row level security;
revoke all on public.member_subscriptions, public.subscription_periods, public.square_plan_variations from anon, authenticated;
grant select on public.member_subscriptions, public.subscription_periods to authenticated;
create policy member_subscriptions_read on public.member_subscriptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy subscription_periods_read on public.subscription_periods for select to authenticated
  using (exists (select 1 from public.member_subscriptions s where s.id = subscription_id and (s.user_id = auth.uid() or public.is_admin())));
grant select (subscription_id, subscription_cycle) on public.memberships to authenticated;

-- Pausing moves an expiry date; with monthly billing that would stretch paid
-- months, so recurring memberships can't be paused (one-off packs still can).
create or replace function public._forbid_recurring_pause()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.memberships where id = new.membership_id and subscription_id is not null) then
    raise exception 'pause_not_available' using detail = 'monthly memberships cannot be paused';
  end if;
  return new;
end;
$$;
create trigger membership_pauses_recurring before insert on public.membership_pauses
  for each row execute function public._forbid_recurring_pause();

-- ---------------------------------------------------------------------------
-- Credit periods
-- ---------------------------------------------------------------------------
create or replace function public._month_start(p_anchor date, p_index int)
returns date
language sql
immutable
as $$
  -- Same rule as Square: a missing day (e.g. 31st) falls on the month's last day.
  select (p_anchor + make_interval(months => p_index))::date;
$$;

-- Local midnight at the end of a date (Dublin).
create or replace function public._end_of_day(p_day date)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select ((p_day + 1)::timestamp at time zone (select timezone from public.app_settings where id));
$$;

-- Expire what's left on a subscription membership (used when the next month
-- or cycle replaces it). Recorded in the ledger.
create or replace function public._close_membership(p_membership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership_id for update;
  if not found or m.expires_at <= now() then return; end if;
  if m.classes_remaining > 0 then
    insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
    values (m.id, m.user_id, -m.classes_remaining, 0, 'period_expired', null, p_reason);
  end if;
  update public.memberships
  set classes_remaining = 0, expires_at = now(), base_expires_at = now()
  where id = m.id;
end;
$$;

-- Issue the classes for billing month p_index, paid by p_pay. Idempotent: a
-- second call for the same month does nothing.
create or replace function public._issue_period(p_subscription_id uuid, p_index int, p_pay public.payments)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  snap jsonb;
  cfg public.app_settings := public._settings();
  v_commit int;
  v_cycle int;
  v_month int;
  v_starts date;
  v_ends date;
  v_cycle_end date;
  v_credits int;
  v_rollover boolean;
  v_purchase_id uuid;
  v_membership_id uuid;
  v_remaining int;
  v_prev record;
  v_send_cancel boolean := false;
begin
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;

  if exists (select 1 from public.subscription_periods where subscription_id = sub.id and period_index = p_index) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  snap := sub.plan_snapshot;
  v_commit := coalesce((snap ->> 'commitment_months')::int, 3);
  v_cycle := p_index / v_commit;
  v_month := p_index % v_commit + 1;
  v_starts := public._month_start(sub.anchor_date, p_index);
  v_ends := public._month_start(sub.anchor_date, p_index + 1);
  v_cycle_end := public._month_start(sub.anchor_date, (v_cycle + 1) * v_commit);
  v_credits := (snap ->> 'class_count')::int;
  v_rollover := coalesce((snap ->> 'credit_rollover')::boolean, false);

  -- The terms of this month's payment (immutable record, like any purchase).
  insert into public.membership_purchases (
    user_id, payment_id, plan_id, plan_code, plan_name, price_cents, currency,
    class_count, validity_days, style_access, allowed_style_ids, excluded_template_ids,
    selected_style_id, first_time_only, activation_policy, cancellation_cutoff_minutes, is_test
  ) values (
    sub.user_id, p_pay.id, (snap ->> 'plan_id')::uuid, snap ->> 'plan_code', snap ->> 'plan_name',
    p_pay.amount_cents, p_pay.currency, v_credits, v_ends - v_starts,
    (snap ->> 'style_access')::public.style_access,
    array(select jsonb_array_elements_text(snap -> 'allowed_style_ids')::uuid),
    array(select jsonb_array_elements_text(snap -> 'excluded_template_ids')::uuid),
    (snap ->> 'selected_style_id')::uuid, false, 'on_purchase', cfg.cancellation_cutoff_minutes, sub.is_test
  ) returning id into v_purchase_id;

  if v_rollover then
    select id into v_membership_id from public.memberships
    where subscription_id = sub.id and subscription_cycle = v_cycle and expires_at > now()
    for update;
  end if;

  if v_membership_id is null then
    -- New month (no rollover) or new cycle (rollover): previous credits expire.
    for v_prev in
      select id from public.memberships
      where subscription_id = sub.id and expires_at > now() and admin_status = 'valid'
    loop
      perform public._close_membership(v_prev.id,
        case when v_rollover then 'Three-month cycle ended' else 'Billing month ended' end);
    end loop;

    insert into public.memberships (
      purchase_id, user_id, plan_name, style_access, selected_style_id,
      classes_total, classes_remaining, activated_at, expires_at, base_expires_at, is_test,
      subscription_id, subscription_cycle
    ) values (
      v_purchase_id, sub.user_id, snap ->> 'plan_name', (snap ->> 'style_access')::public.style_access,
      (snap ->> 'selected_style_id')::uuid, v_credits, v_credits, now(),
      -- Valid through the next billing date (or the cycle's end) so a renewal
      -- charged later that day never leaves a gap; the next month closes it.
      public._end_of_day(case when v_rollover then v_cycle_end else v_ends end),
      public._end_of_day(case when v_rollover then v_cycle_end else v_ends end),
      sub.is_test, sub.id, v_cycle
    ) returning id into v_membership_id;
    v_remaining := v_credits;
  else
    -- All In, months 2 and 3: add this month's classes to the cycle.
    update public.memberships
    set classes_total = classes_total + v_credits, classes_remaining = classes_remaining + v_credits
    where id = v_membership_id
    returning classes_remaining into v_remaining;
  end if;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
  values (v_membership_id, sub.user_id, v_credits, v_remaining,
          case when p_index = 0 then 'grant_purchase' else 'grant_renewal' end::public.ledger_kind, null,
          format('Month %s of cycle %s · payment %s', v_month, v_cycle + 1, p_pay.id));

  insert into public.subscription_periods (subscription_id, period_index, cycle_no, month_in_cycle, starts_on, ends_on,
                                           payment_id, membership_id, credits_issued)
  values (sub.id, p_index, v_cycle, v_month, v_starts, v_ends, p_pay.id, v_membership_id, v_credits);

  -- A cancellation takes effect at the end of the cycle: Square's cancel stops
  -- billing after the current month, so it's sent once the cycle's last month is paid.
  v_send_cancel := sub.status = 'cancel_scheduled' and sub.provider_cancel_sent_at is null
                   and v_ends >= sub.cancel_effective_on;

  update public.member_subscriptions
  set last_period_index = greatest(last_period_index, p_index),
      status = case when status = 'past_due' then 'active' else status end
  where id = sub.id;

  perform public._audit('subscription_period_paid', 'subscription', sub.id::text,
    jsonb_build_object('period_index', p_index, 'cycle', v_cycle + 1, 'month', v_month, 'credits', v_credits,
                       'payment_id', p_pay.id, 'membership_id', v_membership_id));

  return jsonb_build_object('ok', true, 'duplicate', false, 'membership_id', v_membership_id,
                            'subscription_id', sub.id, 'period_index', p_index, 'send_provider_cancel', v_send_cancel);
end;
$$;

-- First payment of a monthly membership: start the subscription and month 1.
create or replace function public._start_subscription(p_pay public.payments)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.member_subscriptions (user_id, plan_id, plan_snapshot, provider, initial_payment_id, anchor_date, is_test)
  values (p_pay.user_id, p_pay.plan_id, p_pay.plan_snapshot, p_pay.provider, p_pay.id, public._local_date(now()), p_pay.is_test)
  on conflict (initial_payment_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.member_subscriptions where initial_payment_id = p_pay.id;
  end if;
  perform public._audit('subscription_started', 'subscription', v_id::text,
    jsonb_build_object('payment_id', p_pay.id, 'plan_name', p_pay.plan_snapshot ->> 'plan_name', 'user_id', p_pay.user_id));
  return public._issue_period(v_id, 0, p_pay);
end;
$$;

-- fulfill_payment: same as before, but a monthly plan starts a subscription.
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
  v_sub jsonb;
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
    return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', true,
      'subscription_id', (select id from public.member_subscriptions where initial_payment_id = pay.id));
  end if;

  if pay.provider <> p_provider then perform public._fail('provider_mismatch'); end if;
  if pay.status not in ('pending', 'cancelled', 'failed') then perform public._fail('payment_not_fulfillable', pay.status::text); end if;

  if p_amount_cents is distinct from pay.amount_cents or upper(p_currency) is distinct from upper(pay.currency) then
    update public.payments set status = 'failed',
      failure_reason = format('amount mismatch: expected %s %s, got %s %s', pay.amount_cents, pay.currency, p_amount_cents, p_currency)
    where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  v_was_cancelled := pay.status in ('cancelled', 'failed');

  update public.payments
  set status = 'succeeded', completed_at = now(), provider_payment_ref = p_provider_ref,
      provider_event_id = p_provider_event_id, failure_reason = null,
      review_reason = case when v_was_cancelled then 'paid_after_cancel' end
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

  if pay.plan_snapshot ->> 'billing_interval' = 'monthly' then
    v_sub := public._start_subscription(pay);
    return v_sub || jsonb_build_object('ok', true, 'duplicate', false);
  end if;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Provider (Square) events — service role only
-- ---------------------------------------------------------------------------

-- Record which Square subscription belongs to our subscription.
create or replace function public.link_provider_subscription(p_payment_id uuid, p_provider_subscription_id text, p_provider_customer_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
begin
  select * into sub from public.member_subscriptions where initial_payment_id = p_payment_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if sub.provider_subscription_id is not null and sub.provider_subscription_id <> p_provider_subscription_id then
    perform public._fail('subscription_already_linked');
  end if;
  update public.member_subscriptions
  set provider_subscription_id = p_provider_subscription_id, provider_customer_id = coalesce(p_provider_customer_id, provider_customer_id)
  where id = sub.id;
  return jsonb_build_object('ok', true, 'subscription_id', sub.id,
    'send_provider_cancel', sub.status = 'cancel_scheduled' and sub.provider_cancel_sent_at is null
      and public._month_start(sub.anchor_date, sub.last_period_index + 1) >= sub.cancel_effective_on);
end;
$$;

-- A monthly charge was collected (Square invoice paid). Idempotent per Square
-- payment: repeated webhooks return the first result.
create or replace function public.fulfill_subscription_charge(
  p_provider_subscription_id text,
  p_provider_payment_ref text,
  p_provider_event_id text,
  p_amount_cents int,
  p_currency text,
  p_paid_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  pay public.payments;
  v_index int;
  v_day date;
  v_existing public.payments;
begin
  select * into sub from public.member_subscriptions where provider_subscription_id = p_provider_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;

  -- Same Square payment seen before (webhook retry): nothing new.
  select * into v_existing from public.payments
  where provider = sub.provider and provider_payment_ref = p_provider_payment_ref and status = 'succeeded';
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', v_existing.id);
  end if;
  -- The checkout payment itself (month 1) may also arrive as an invoice payment.
  if exists (select 1 from public.payments where id = sub.initial_payment_id and provider_payment_ref = p_provider_payment_ref) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', sub.initial_payment_id);
  end if;

  -- Which billing month is this? The latest month that has started (allowing a
  -- day for time-zone differences in when Square charges).
  v_day := public._local_date(p_paid_at) + 1;
  v_index := greatest(sub.last_period_index, 0);
  while public._month_start(sub.anchor_date, v_index + 1) <= v_day loop
    v_index := v_index + 1;
  end loop;

  -- Square also reports the first month (paid at checkout) as a subscription
  -- invoice: that's the same money, not a second payment.
  if v_index = 0 then
    perform public._audit('subscription_first_invoice', 'subscription', sub.id::text,
      jsonb_build_object('provider_payment_ref', p_provider_payment_ref));
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', sub.initial_payment_id);
  end if;

  insert into public.payments (
    user_id, plan_id, selected_style_id, plan_snapshot, amount_cents, currency, provider, is_test,
    idempotency_key, created_by, status, completed_at, provider_payment_ref, provider_event_id, kind
  ) values (
    sub.user_id, sub.plan_id, (sub.plan_snapshot ->> 'selected_style_id')::uuid, sub.plan_snapshot,
    p_amount_cents, upper(p_currency), sub.provider, sub.is_test,
    'sub:' || p_provider_payment_ref, null, 'pending', null, null, null, 'membership'
  ) returning * into pay;

  if p_amount_cents is distinct from (sub.plan_snapshot ->> 'price_cents')::int
     or upper(p_currency) is distinct from upper(sub.plan_snapshot ->> 'currency') then
    update public.payments set status = 'succeeded', completed_at = p_paid_at, provider_payment_ref = p_provider_payment_ref,
      provider_event_id = p_provider_event_id, review_reason = 'amount_mismatch'
    where id = pay.id;
    perform public._audit('payment_review_required', 'payment', pay.id::text,
      jsonb_build_object('reason', 'amount_mismatch', 'subscription_id', sub.id, 'amount_cents', p_amount_cents));
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch', 'payment_id', pay.id);
  end if;

  update public.payments set status = 'succeeded', completed_at = p_paid_at, provider_payment_ref = p_provider_payment_ref,
    provider_event_id = p_provider_event_id
  where id = pay.id
  returning * into pay;

  if exists (select 1 from public.subscription_periods where subscription_id = sub.id and period_index = v_index) then
    -- Money for a month that's already covered (e.g. an old invoice paid late):
    -- accepted, no extra classes, and the studio is asked to review it.
    update public.payments set review_reason = 'month_already_paid' where id = pay.id;
    perform public._audit('payment_review_required', 'payment', pay.id::text,
      jsonb_build_object('reason', 'month_already_paid', 'subscription_id', sub.id, 'period_index', v_index));
    return jsonb_build_object('ok', true, 'duplicate', false, 'payment_id', pay.id, 'review', true);
  end if;

  return public._issue_period(sub.id, v_index, pay) || jsonb_build_object('payment_id', pay.id);
end;
$$;

-- A monthly charge failed: no classes are issued; member and studio are told.
create or replace function public.subscription_charge_failed(p_provider_subscription_id text, p_provider_payment_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
begin
  select * into sub from public.member_subscriptions where provider_subscription_id = p_provider_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if sub.status = 'ended' then return jsonb_build_object('ok', true, 'ignored', true); end if;
  update public.member_subscriptions set status = case when status = 'cancel_scheduled' then status else 'past_due' end where id = sub.id;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (sub.user_id, 'subscription_payment_failed',
          jsonb_build_object('plan_name', sub.plan_snapshot ->> 'plan_name', 'price_cents', (sub.plan_snapshot ->> 'price_cents')::int),
          'subfail:' || p_provider_payment_ref)
  on conflict (dedupe_key) do nothing;
  perform public._audit('subscription_payment_failed', 'subscription', sub.id::text,
    jsonb_build_object('provider_payment_ref', p_provider_payment_ref, 'user_id', sub.user_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- Square says the subscription is over (cancelled, completed or deactivated).
create or replace function public.subscription_provider_ended(p_provider_subscription_id text, p_provider_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
begin
  select * into sub from public.member_subscriptions where provider_subscription_id = p_provider_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if sub.status = 'ended' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  update public.member_subscriptions set status = 'ended', ended_at = now() where id = sub.id;
  perform public._audit('subscription_ended', 'subscription', sub.id::text,
    jsonb_build_object('provider_status', p_provider_status, 'requested', sub.cancel_requested_at is not null));
  if sub.cancel_requested_at is null then
    -- Not asked for by the member or studio (e.g. Square deactivated it): tell the studio.
    insert into public.notification_outbox (user_id, kind, payload)
    select a.id, 'subscription_ended_unexpectedly', jsonb_build_object(
      'member_name', (select full_name from public.profiles where id = sub.user_id), 'plan_name', sub.plan_snapshot ->> 'plan_name',
      'provider_status', p_provider_status, 'user_id', sub.user_id)
    from public.profiles a where a.role = 'admin';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mark_provider_cancel_sent(p_subscription_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.member_subscriptions set provider_cancel_sent_at = coalesce(provider_cancel_sent_at, now()) where id = p_subscription_id;
$$;

-- ---------------------------------------------------------------------------
-- Cancelling (member and admin)
-- ---------------------------------------------------------------------------

-- Member: stop renewing. Billing continues to the end of the current 3-month
-- cycle (the commitment); classes stay usable until then.
create or replace function public.request_subscription_cancel(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  v_commit int;
  v_cycle int;
  v_effective date;
  v_next_billing date;
begin
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found or (sub.user_id <> auth.uid() and not public.is_admin()) then perform public._fail('subscription_not_found'); end if;
  if sub.status in ('cancel_scheduled', 'ended') then perform public._fail('subscription_not_active'); end if;

  v_commit := coalesce((sub.plan_snapshot ->> 'commitment_months')::int, 3);
  v_cycle := greatest(sub.last_period_index, 0) / v_commit;
  v_effective := public._month_start(sub.anchor_date, (v_cycle + 1) * v_commit);
  v_next_billing := public._month_start(sub.anchor_date, sub.last_period_index + 1);

  update public.member_subscriptions
  set status = 'cancel_scheduled', cancel_requested_at = now(), cancel_requested_by = auth.uid(), cancel_effective_on = v_effective
  where id = sub.id;
  perform public._audit('subscription_cancel_requested', 'subscription', sub.id::text,
    jsonb_build_object('effective_on', v_effective, 'by_admin', sub.user_id <> auth.uid()));

  return jsonb_build_object('ok', true, 'subscription_id', sub.id, 'ends_on', v_effective,
    'payments_left', greatest(0, (v_cycle + 1) * v_commit - (sub.last_period_index + 1)),
    -- Square stops after the month it's in: send now if the cycle's last month is paid.
    'send_provider_cancel', v_next_billing >= v_effective);
end;
$$;

-- Member changes their mind before the cancellation has been sent to Square.
create or replace function public.undo_subscription_cancel(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
begin
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found or (sub.user_id <> auth.uid() and not public.is_admin()) then perform public._fail('subscription_not_found'); end if;
  if sub.status <> 'cancel_scheduled' then perform public._fail('subscription_not_cancelling'); end if;
  if sub.provider_cancel_sent_at is not null then perform public._fail('cancel_already_processed'); end if;
  update public.member_subscriptions
  set status = 'active', cancel_requested_at = null, cancel_requested_by = null, cancel_effective_on = null
  where id = sub.id;
  perform public._audit('subscription_cancel_undone', 'subscription', sub.id::text, '{}');
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: end at the end of the current billing month, waiving the rest of the
-- commitment (e.g. within the 14-day cooling-off period, injury, moving away).
create or replace function public.admin_end_subscription_now(p_subscription_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  v_effective date;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if sub.status = 'ended' then perform public._fail('subscription_not_active'); end if;
  v_effective := public._month_start(sub.anchor_date, sub.last_period_index + 1);
  update public.member_subscriptions
  set status = 'cancel_scheduled', cancel_requested_at = coalesce(cancel_requested_at, now()),
      cancel_requested_by = coalesce(cancel_requested_by, auth.uid()), cancel_effective_on = v_effective
  where id = sub.id;
  perform public._audit('subscription_ended_by_studio', 'subscription', sub.id::text,
    jsonb_build_object('reason', p_reason, 'effective_on', v_effective, 'user_id', sub.user_id));
  return jsonb_build_object('ok', true, 'subscription_id', sub.id, 'ends_on', v_effective, 'send_provider_cancel', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reminders: renewal for another 3 months, and the last month of a cancelled
-- membership. Daily, 7 days ahead. One per subscription and cycle.
-- ---------------------------------------------------------------------------
create or replace function public.queue_subscription_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._local_date(now());
  v_count int;
begin
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select s.user_id,
         case when s.status = 'cancel_scheduled' then 'subscription_ending' else 'subscription_renewing' end,
         jsonb_build_object('plan_name', s.plan_snapshot ->> 'plan_name', 'price_cents', (s.plan_snapshot ->> 'price_cents')::int,
                            'class_count', (s.plan_snapshot ->> 'class_count')::int,
                            'commitment_months', (s.plan_snapshot ->> 'commitment_months')::int, 'on', x.cycle_end),
         format('subcycle:%s:%s:%s', s.id, x.cycle_end, s.status)
  from public.member_subscriptions s
  cross join lateral (
    select public._month_start(s.anchor_date,
      (greatest(s.last_period_index, 0) / coalesce((s.plan_snapshot ->> 'commitment_months')::int, 3) + 1)
      * coalesce((s.plan_snapshot ->> 'commitment_months')::int, 3)) as cycle_end
  ) x
  where s.status in ('active', 'past_due', 'cancel_scheduled')
    and x.cycle_end - v_today between 0 and 7
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-subscription-reminders', '20 9 * * *', $job$select public.queue_subscription_reminders()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._month_start(date, int), public._end_of_day(date), public._close_membership(uuid, text),
  public._issue_period(uuid, int, public.payments), public._start_subscription(public.payments),
  public.link_provider_subscription(uuid, text, text), public.fulfill_subscription_charge(text, text, text, int, text, timestamptz),
  public.subscription_charge_failed(text, text), public.subscription_provider_ended(text, text),
  public.mark_provider_cancel_sent(uuid), public.request_subscription_cancel(uuid), public.undo_subscription_cancel(uuid),
  public.admin_end_subscription_now(uuid, text), public.queue_subscription_reminders()
  from public, anon, authenticated;
grant execute on function public.request_subscription_cancel(uuid), public.undo_subscription_cancel(uuid),
  public.admin_end_subscription_now(uuid, text) to authenticated;
grant execute on function public.link_provider_subscription(uuid, text, text),
  public.fulfill_subscription_charge(text, text, text, int, text, timestamptz),
  public.subscription_charge_failed(text, text), public.subscription_provider_ended(text, text),
  public.mark_provider_cancel_sent(uuid), public.queue_subscription_reminders() to service_role;
