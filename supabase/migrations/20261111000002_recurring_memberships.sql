-- Drop Studios — monthly memberships: 3 monthly payments, then they stop.
--
-- Plans:     intro-3 stays a one-off pack. single-4, multi-5, multi-8 and
--            multi-12 are monthly memberships: charged every month (Square
--            subscription, same day each month) for 3 payments, then the
--            membership ends and the member signs up again if they wish.
-- Credits:   every paid month issues the plan's classes.
--            * No rollover (Single Style, Multi-Style, Committed): each month is
--              its own membership row valid until the next payment date; when
--              the next month is paid, what's left expires ('period_expired').
--            * Rollover (All In): one membership row for the 3 months; months 2
--              and 3 add their classes to it ('grant_renewal'); whatever is left
--              when the 3 months end expires with it.
--            The unique (subscription, period_index) makes credit issuing
--            idempotent: a repeated webhook can never issue classes twice.
-- Cancel:    any time, no penalty. It takes effect at the next payment date if
--            asked at least 72 hours before it; otherwise after the next payment.
-- Pause:     pausing a monthly membership moves the next payment date (and the
--            end date) back by the paused days. Square can't move a payment
--            day safely, so the Square subscription is stopped at the end of
--            the paid month and a new one (same saved card, remaining payments)
--            is started on the new payment date by the subscription-jobs
--            function (pending_restart).
-- Upgrade:   a member with no classes left can move to a dearer plan; the old
--            membership stops and the new one starts.
-- Reward:    members who complete all 3 payments and sign up again get 3 free
--            classes to use within 7 days ('grant_reward').
-- Square:    plan variations (MONTHLY, 3 periods) are created on demand by
--            create-checkout and kept in square_plan_variations.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
alter table public.membership_plans
  add column billing_interval text not null default 'one_off' check (billing_interval in ('one_off', 'monthly')),
  -- Number of monthly payments before the membership ends (3).
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

-- ---------------------------------------------------------------------------
-- Subscriptions and their paid months
-- ---------------------------------------------------------------------------
create table public.member_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  plan_id uuid not null references public.membership_plans (id),
  -- Terms agreed at checkout (price, monthly classes, rollover, number of payments).
  plan_snapshot jsonb not null,
  status text not null default 'active'
    check (status in ('active', 'past_due', 'cancel_scheduled', 'ended')),
  end_reason text check (end_reason in ('completed', 'cancelled', 'upgraded', 'provider')),
  provider public.payment_provider not null,
  provider_subscription_id text unique,
  provider_customer_id text,
  initial_payment_id uuid not null unique references public.payments (id),
  total_periods int not null check (total_periods > 0),
  periods_paid int not null default 0,
  -- Date of the next monthly payment (Dublin); null once all payments are made.
  next_billing_on date,
  -- When the last paid month ends (moves with pauses).
  current_period_ends_on date,
  -- Set when a pause moved the payment date and Square's subscription still
  -- has to be stopped at the end of the paid month.
  billing_sync_needed boolean not null default false,
  -- Square's subscription was stopped for a pause; a new one starts on
  -- next_billing_on with the saved card for the remaining payments.
  pending_restart boolean not null default false,
  provider_card_id text,
  cancel_requested_at timestamptz,
  cancel_requested_by uuid references public.profiles (id),
  -- Payments stop from this date (a payment date).
  cancel_effective_on date,
  provider_cancel_sent_at timestamptz,
  upgraded_to uuid references public.member_subscriptions (id),
  -- The loyalty reward this subscription earned has been given (once).
  reward_used_at timestamptz,
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
  starts_on date not null,
  ends_on date not null,   -- next payment date (exclusive)
  payment_id uuid not null unique references public.payments (id),
  membership_id uuid not null references public.memberships (id),
  credits_issued int not null check (credits_issued > 0),
  created_at timestamptz not null default now(),
  unique (subscription_id, period_index)
);

alter table public.memberships add column subscription_id uuid references public.member_subscriptions (id);
create index memberships_subscription_idx on public.memberships (subscription_id) where subscription_id is not null;

-- Square's own payment id for an invoice payment (found when refunding).
alter table public.payments add column provider_payment_id text;

-- Square catalog plan variations created by create-checkout (service role only).
create table public.square_plan_variations (
  plan_id uuid not null references public.membership_plans (id),
  environment text not null check (environment in ('sandbox', 'production')),
  price_cents int not null,
  periods int not null,
  plan_object_id text not null,
  variation_id text not null,
  created_at timestamptz not null default now(),
  primary key (plan_id, environment, price_cents, periods)
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
grant select (subscription_id) on public.memberships to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._add_month(p_day date)
returns date
language sql
immutable
as $$
  -- Same rule as Square: a missing day (e.g. 31st) falls on the month's last day.
  select (p_day + interval '1 month')::date;
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

-- Expire what's left on a membership now (next month / upgrade). In the ledger.
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

-- A membership row for a purchase (or reward), with its ledger grant.
create or replace function public._grant_membership(
  p_user_id uuid, p_pay public.payments, p_snap jsonb, p_credits int, p_expires_at timestamptz,
  p_subscription_id uuid, p_kind public.ledger_kind, p_reason text, p_purchase_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cfg public.app_settings := public._settings();
  v_purchase_id uuid;
  v_membership_id uuid;
  v_name text := coalesce(p_purchase_name, p_snap ->> 'plan_name');
begin
  insert into public.membership_purchases (
    user_id, payment_id, plan_id, plan_code, plan_name, price_cents, currency,
    class_count, validity_days, style_access, allowed_style_ids, excluded_template_ids,
    selected_style_id, first_time_only, activation_policy, cancellation_cutoff_minutes, is_test
  ) values (
    p_user_id, p_pay.id, (p_snap ->> 'plan_id')::uuid, p_snap ->> 'plan_code', v_name,
    p_pay.amount_cents, p_pay.currency, p_credits, greatest(1, public._local_date(p_expires_at) - public._local_date(now())),
    (p_snap ->> 'style_access')::public.style_access,
    array(select jsonb_array_elements_text(p_snap -> 'allowed_style_ids')::uuid),
    array(select jsonb_array_elements_text(p_snap -> 'excluded_template_ids')::uuid),
    (p_snap ->> 'selected_style_id')::uuid, false, 'on_purchase', cfg.cancellation_cutoff_minutes, p_pay.is_test
  ) returning id into v_purchase_id;

  insert into public.memberships (
    purchase_id, user_id, plan_name, style_access, selected_style_id,
    classes_total, classes_remaining, activated_at, expires_at, base_expires_at, is_test, subscription_id
  ) values (
    v_purchase_id, p_user_id, v_name, (p_snap ->> 'style_access')::public.style_access,
    (p_snap ->> 'selected_style_id')::uuid, p_credits, p_credits, now(), p_expires_at, p_expires_at, p_pay.is_test, p_subscription_id
  ) returning id into v_membership_id;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
  values (v_membership_id, p_user_id, p_credits, p_credits, p_kind, null, p_reason);
  return v_membership_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Paid months
-- ---------------------------------------------------------------------------

-- Issue the classes for the next paid month of a subscription. Idempotent per
-- period index (a repeated call for the same month does nothing).
create or replace function public._issue_period(p_subscription_id uuid, p_index int, p_pay public.payments)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  snap jsonb;
  v_starts date;
  v_ends date;
  v_credits int;
  v_rollover boolean;
  v_membership_id uuid;
  v_remaining int;
  v_prev record;
  v_last boolean;
  v_send_cancel boolean;
begin
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if exists (select 1 from public.subscription_periods where subscription_id = sub.id and period_index = p_index) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  snap := sub.plan_snapshot;
  v_credits := (snap ->> 'class_count')::int;
  v_rollover := coalesce((snap ->> 'credit_rollover')::boolean, false);
  v_starts := coalesce(case when p_index = 0 then null else sub.next_billing_on end, public._local_date(now()));
  v_ends := public._add_month(v_starts);
  v_last := p_index + 1 >= sub.total_periods;

  if v_rollover and p_index > 0 then
    select id into v_membership_id from public.memberships
    where subscription_id = sub.id and expires_at > now() and admin_status = 'valid'
    order by created_at desc limit 1
    for update;
  end if;

  if v_membership_id is null then
    -- A new month (no rollover): last month's unused classes expire now.
    for v_prev in select id from public.memberships where subscription_id = sub.id and expires_at > now() loop
      perform public._close_membership(v_prev.id, 'Billing month ended');
    end loop;
    -- Valid through the next payment date (so a payment taken later that day
    -- never leaves a gap; the next month closes it). With rollover, valid to the
    -- end of all the paid months.
    v_membership_id := public._grant_membership(sub.user_id, p_pay, snap, v_credits,
      public._end_of_day(case when v_rollover then
        (select (v_starts + make_interval(months => sub.total_periods - p_index))::date) else v_ends end),
      sub.id, case when p_index = 0 then 'grant_purchase' else 'grant_renewal' end::public.ledger_kind,
      format('Month %s of %s · payment %s', p_index + 1, sub.total_periods, p_pay.id));
  else
    -- All In: this month's classes are added on top of what's left.
    insert into public.membership_purchases (
      user_id, payment_id, plan_id, plan_code, plan_name, price_cents, currency, class_count, validity_days, style_access,
      allowed_style_ids, excluded_template_ids, selected_style_id, first_time_only, activation_policy, cancellation_cutoff_minutes, is_test
    )
    select sub.user_id, p_pay.id, pu.plan_id, pu.plan_code, pu.plan_name, p_pay.amount_cents, p_pay.currency, v_credits,
           v_ends - v_starts, pu.style_access, pu.allowed_style_ids, pu.excluded_template_ids, pu.selected_style_id, false,
           pu.activation_policy, pu.cancellation_cutoff_minutes, sub.is_test
    from public.memberships m join public.membership_purchases pu on pu.id = m.purchase_id where m.id = v_membership_id;
    update public.memberships
    set classes_total = classes_total + v_credits, classes_remaining = classes_remaining + v_credits
    where id = v_membership_id
    returning classes_remaining into v_remaining;
    insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
    values (v_membership_id, sub.user_id, v_credits, v_remaining, 'grant_renewal', null,
            format('Month %s of %s · payment %s', p_index + 1, sub.total_periods, p_pay.id));
  end if;

  insert into public.subscription_periods (subscription_id, period_index, starts_on, ends_on, payment_id, membership_id, credits_issued)
  values (sub.id, p_index, v_starts, v_ends, p_pay.id, v_membership_id, v_credits);

  -- A cancellation that waited for this payment can now go to Square.
  v_send_cancel := sub.status = 'cancel_scheduled' and sub.provider_cancel_sent_at is null
                   and sub.cancel_effective_on <= v_ends;

  update public.member_subscriptions
  set periods_paid = greatest(periods_paid, p_index + 1),
      next_billing_on = case when v_last or (status = 'cancel_scheduled' and cancel_effective_on <= v_ends) then null else v_ends end,
      current_period_ends_on = v_ends,
      status = case when status = 'past_due' then 'active' else status end
  where id = sub.id;

  perform public._audit('subscription_period_paid', 'subscription', sub.id::text,
    jsonb_build_object('month', p_index + 1, 'of', sub.total_periods, 'credits', v_credits,
                       'payment_id', p_pay.id, 'membership_id', v_membership_id));

  return jsonb_build_object('ok', true, 'duplicate', false, 'membership_id', v_membership_id,
                            'subscription_id', sub.id, 'period_index', p_index, 'send_provider_cancel', v_send_cancel);
end;
$$;

-- Loyalty reward: a member who completed every payment of a previous monthly
-- membership and signs up again gets 3 free classes for 7 days. Once per
-- completed membership.
create or replace function public._grant_loyalty_reward(p_new public.member_subscriptions, p_pay public.payments)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.member_subscriptions;
  v_snap jsonb;
  v_pay public.payments;
  v_membership_id uuid;
begin
  select * into v_old from public.member_subscriptions
  where user_id = p_new.user_id and id <> p_new.id and periods_paid >= total_periods
    and coalesce(end_reason, 'completed') <> 'upgraded' and reward_used_at is null
  order by created_at desc limit 1
  for update;
  if not found then return null; end if;

  -- Any style, any class: same eligibility as a multi-style plan.
  v_snap := p_new.plan_snapshot || jsonb_build_object(
    'style_access', 'multi', 'selected_style_id', null,
    'allowed_style_ids', (select coalesce(jsonb_agg(id order by sort_order), '[]') from public.dance_styles where is_active),
    'excluded_template_ids', '[]'::jsonb);

  insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, status,
                               idempotency_key, completed_at, kind)
  values (p_new.user_id, p_new.plan_id, v_snap || jsonb_build_object('plan_name', 'Loyalty reward'), 0, 'EUR', 'manual',
          p_new.is_test, 'succeeded', 'reward:' || v_old.id, now(), 'membership')
  returning * into v_pay;

  v_membership_id := public._grant_membership(p_new.user_id, v_pay, v_snap, 3,
    public._end_of_day(public._local_date(now()) + 7), null, 'grant_reward',
    'Loyalty reward: 3 months completed', 'Loyalty reward · 3 free classes');
  update public.member_subscriptions set reward_used_at = now() where id = v_old.id;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (p_new.user_id, 'loyalty_reward', jsonb_build_object('classes', 3, 'days', 7, 'membership_id', v_membership_id),
          'reward:' || v_old.id);
  perform public._audit('loyalty_reward_granted', 'membership', v_membership_id::text,
    jsonb_build_object('earned_by', v_old.id, 'new_subscription', p_new.id, 'user_id', p_new.user_id));
  return v_membership_id;
end;
$$;

-- First payment of a monthly membership: start it, issue month 1, finish an
-- upgrade, and give the loyalty reward if earned.
create or replace function public._start_subscription(p_pay public.payments)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  v_result jsonb;
  v_old public.member_subscriptions;
  v_prev record;
  v_reward uuid;
  v_cancel_old text;
begin
  insert into public.member_subscriptions (user_id, plan_id, plan_snapshot, provider, initial_payment_id, total_periods, is_test)
  values (p_pay.user_id, p_pay.plan_id, p_pay.plan_snapshot, p_pay.provider, p_pay.id,
          coalesce((p_pay.plan_snapshot ->> 'commitment_months')::int, 3), p_pay.is_test)
  on conflict (initial_payment_id) do nothing
  returning * into sub;
  if sub.id is null then
    select * into sub from public.member_subscriptions where initial_payment_id = p_pay.id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'subscription_id', sub.id);
  end if;

  v_result := public._issue_period(sub.id, 0, p_pay);

  -- Upgrade: the old membership stops now (its classes were used up).
  if p_pay.plan_snapshot ? 'upgrade_from' then
    select * into v_old from public.member_subscriptions where id = (p_pay.plan_snapshot ->> 'upgrade_from')::uuid for update;
    if found and v_old.status <> 'ended' then
      for v_prev in select id from public.memberships where subscription_id = v_old.id and expires_at > now() loop
        perform public._close_membership(v_prev.id, 'Upgraded to ' || (p_pay.plan_snapshot ->> 'plan_name'));
      end loop;
      update public.member_subscriptions
      set status = 'ended', end_reason = 'upgraded', upgraded_to = sub.id, ended_at = now(), next_billing_on = null
      where id = v_old.id;
      v_cancel_old := v_old.id::text;
      perform public._audit('subscription_upgraded', 'subscription', v_old.id::text,
        jsonb_build_object('to', sub.id, 'plan_name', p_pay.plan_snapshot ->> 'plan_name'));
    end if;
  end if;

  select * into sub from public.member_subscriptions where id = sub.id;
  v_reward := public._grant_loyalty_reward(sub, p_pay);
  perform public._audit('subscription_started', 'subscription', sub.id::text,
    jsonb_build_object('payment_id', p_pay.id, 'plan_name', p_pay.plan_snapshot ->> 'plan_name', 'user_id', p_pay.user_id,
                       'reward_membership_id', v_reward));
  return v_result || jsonb_build_object('reward_membership_id', v_reward, 'cancel_provider_subscription_of', v_cancel_old);
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
  v_live public.member_subscriptions;
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

    -- One monthly membership at a time (a second one would bill twice). The
    -- exception is an upgrade: no classes left and a dearer plan.
    if v_snap ->> 'billing_interval' = 'monthly' then
      select * into v_live from public.member_subscriptions
      where user_id = v_uid and status in ('active', 'past_due', 'cancel_scheduled')
      order by created_at desc limit 1;
      if found then
        if (v_snap ->> 'price_cents')::int <= (v_live.plan_snapshot ->> 'price_cents')::int
           or exists (select 1 from public.memberships m
                      where m.user_id = v_uid and m.admin_status = 'valid' and m.classes_remaining > 0
                        and m.activated_at is not null and m.expires_at > now()) then
          perform public._fail('already_subscribed');
        end if;
        v_snap := v_snap || jsonb_build_object('upgrade_from', v_live.id);
      end if;
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
-- Pausing moves the next payment date
-- ---------------------------------------------------------------------------
create or replace function public._pause_moves_billing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sub_id uuid;
  sub public.member_subscriptions;
  v_old int := 0;
  v_new int := 0;
  v_delta int;
begin
  select subscription_id into v_sub_id from public.memberships where id = new.membership_id;
  if v_sub_id is null then return new; end if;
  select * into sub from public.member_subscriptions where id = v_sub_id for update;
  if sub.status = 'ended' then return new; end if;

  if tg_op = 'INSERT' and sub.next_billing_on is not null and new.starts_on >= sub.next_billing_on then
    raise exception 'pause_after_next_payment' using detail = 'a pause must start before the next payment date';
  end if;
  if tg_op = 'UPDATE' and not old.is_cancelled then v_old := old.ends_on - old.starts_on + 1; end if;
  if not new.is_cancelled then v_new := new.ends_on - new.starts_on + 1; end if;
  v_delta := v_new - v_old;
  if v_delta = 0 then return new; end if;

  update public.member_subscriptions
  set next_billing_on = next_billing_on + v_delta,
      current_period_ends_on = current_period_ends_on + v_delta,
      cancel_effective_on = cancel_effective_on + v_delta,
      billing_sync_needed = next_billing_on is not null and not pending_restart
  where id = sub.id;
  perform public._audit('subscription_billing_moved', 'subscription', sub.id::text,
    jsonb_build_object('days', v_delta, 'pause_id', new.id, 'next_billing_on', sub.next_billing_on + v_delta));
  return new;
end;
$$;
create trigger membership_pauses_move_billing after insert or update on public.membership_pauses
  for each row execute function public._pause_moves_billing();

-- Square's subscription was stopped at the end of the paid month (pause).
create or replace function public.mark_billing_synced(p_subscription_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.member_subscriptions set billing_sync_needed = false, pending_restart = true where id = p_subscription_id;
$$;

-- The new Square subscription started after a pause (or found by the webhook).
create or replace function public.replace_provider_subscription(p_subscription_id uuid, p_provider_subscription_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  select provider_subscription_id into v_old from public.member_subscriptions where id = p_subscription_id for update;
  update public.member_subscriptions
  set provider_subscription_id = p_provider_subscription_id, pending_restart = false
  where id = p_subscription_id;
  perform public._audit('subscription_restarted', 'subscription', p_subscription_id::text,
    jsonb_build_object('previous', v_old, 'provider_subscription_id', p_provider_subscription_id));
end;
$$;

-- Paused memberships whose new payment date has come: start Square again.
create or replace function public.subscriptions_due_restart()
returns table (subscription_id uuid, provider_subscription_id text, provider_customer_id text, provider_card_id text,
               plan_id uuid, price_cents int, payments_left int, next_billing_on date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, provider_subscription_id, provider_customer_id, provider_card_id, plan_id,
         (plan_snapshot ->> 'price_cents')::int, total_periods - periods_paid, next_billing_on
  from public.member_subscriptions
  where pending_restart and status in ('active', 'past_due') and next_billing_on is not null
    and next_billing_on <= public._local_date(now()) and periods_paid < total_periods;
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
    'send_provider_cancel', sub.status in ('cancel_scheduled', 'ended') and sub.provider_cancel_sent_at is null
      and (sub.status = 'ended' or sub.next_billing_on is null),
    'billing_sync_needed', sub.billing_sync_needed);
end;
$$;

-- A monthly charge was collected (Square invoice paid). Idempotent per invoice.
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
  v_existing public.payments;
  v_day date := public._local_date(p_paid_at);
  v_review text;
begin
  select * into sub from public.member_subscriptions where provider_subscription_id = p_provider_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;

  select * into v_existing from public.payments
  where provider = sub.provider and provider_payment_ref = p_provider_payment_ref and status = 'succeeded';
  if found then return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', v_existing.id); end if;

  -- Square also reports the first month (paid at checkout) as an invoice:
  -- the same money, not a second payment.
  if sub.periods_paid = 1 and (sub.next_billing_on is null or v_day + 1 < sub.next_billing_on) then
    perform public._audit('subscription_first_invoice', 'subscription', sub.id::text,
      jsonb_build_object('provider_payment_ref', p_provider_payment_ref));
    return jsonb_build_object('ok', true, 'duplicate', true, 'payment_id', sub.initial_payment_id);
  end if;

  if sub.next_billing_on is null or sub.periods_paid >= sub.total_periods then
    v_review := 'no_payment_expected';
  elsif v_day + 1 < sub.next_billing_on then
    v_review := 'early_payment';
  elsif p_amount_cents is distinct from (sub.plan_snapshot ->> 'price_cents')::int
        or upper(p_currency) is distinct from upper(sub.plan_snapshot ->> 'currency') then
    v_review := 'amount_mismatch';
  end if;

  insert into public.payments (
    user_id, plan_id, selected_style_id, plan_snapshot, amount_cents, currency, provider, is_test,
    idempotency_key, status, completed_at, provider_payment_ref, provider_event_id, kind, review_reason
  ) values (
    sub.user_id, sub.plan_id, (sub.plan_snapshot ->> 'selected_style_id')::uuid, sub.plan_snapshot,
    p_amount_cents, upper(p_currency), sub.provider, sub.is_test,
    'sub:' || p_provider_payment_ref, 'succeeded', p_paid_at, p_provider_payment_ref, p_provider_event_id, 'membership', v_review
  ) returning * into pay;

  if v_review is not null then
    -- Accepted (the money was taken) but no classes; the studio reviews it.
    perform public._audit('payment_review_required', 'payment', pay.id::text,
      jsonb_build_object('reason', v_review, 'subscription_id', sub.id, 'amount_cents', p_amount_cents));
    insert into public.notification_outbox (user_id, kind, payload)
    select a.id, 'payment_review', jsonb_build_object(
      'member_name', (select full_name from public.profiles where id = sub.user_id),
      'plan_name', sub.plan_snapshot ->> 'plan_name', 'amount_cents', p_amount_cents, 'user_id', sub.user_id)
    from public.profiles a where a.role = 'admin';
    return jsonb_build_object('ok', v_review <> 'amount_mismatch', 'review', true, 'error', v_review, 'payment_id', pay.id);
  end if;

  return public._issue_period(sub.id, sub.periods_paid, pay) || jsonb_build_object('payment_id', pay.id);
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

create or replace function public._end_reason(sub public.member_subscriptions)
returns text
language sql
immutable
as $$
  select case when sub.end_reason is not null then sub.end_reason
              when sub.periods_paid >= sub.total_periods and sub.cancel_requested_at is null then 'completed'
              when sub.cancel_requested_at is not null then 'cancelled'
              else 'provider' end;
$$;

-- Square says the subscription is over (completed, cancelled or deactivated).
create or replace function public.subscription_provider_ended(p_provider_subscription_id text, p_provider_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  v_reason text;
begin
  select * into sub from public.member_subscriptions where provider_subscription_id = p_provider_subscription_id for update;
  if not found then perform public._fail('subscription_not_found'); end if;
  if sub.status = 'ended' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  -- Stopped by us for a pause: the membership carries on with a new Square subscription.
  if sub.pending_restart then return jsonb_build_object('ok', true, 'ignored', 'paused'); end if;
  v_reason := public._end_reason(sub);
  update public.member_subscriptions set status = 'ended', end_reason = v_reason, ended_at = now(), next_billing_on = null where id = sub.id;
  perform public._audit('subscription_ended', 'subscription', sub.id::text,
    jsonb_build_object('provider_status', p_provider_status, 'reason', v_reason));
  if v_reason = 'provider' then
    -- Not asked for and not finished (e.g. Square deactivated it): tell the studio.
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
-- Cancelling: any time, no penalty, 72 hours before the next payment
-- ---------------------------------------------------------------------------
create or replace function public.request_subscription_cancel(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sub public.member_subscriptions;
  v_effective date;
  v_send boolean;
  v_payments_left int;
begin
  select * into sub from public.member_subscriptions where id = p_subscription_id for update;
  if not found or (sub.user_id <> auth.uid() and not public.is_admin()) then perform public._fail('subscription_not_found'); end if;
  if sub.status in ('cancel_scheduled', 'ended') then perform public._fail('subscription_not_active'); end if;

  if sub.next_billing_on is null then
    -- No more payments due: it simply ends with the current month.
    v_effective := sub.current_period_ends_on; v_send := true; v_payments_left := 0;
  elsif now() <= (sub.next_billing_on::timestamp at time zone (select timezone from public.app_settings where id)) - interval '72 hours' then
    -- At least 72 hours' notice: no more payments.
    v_effective := sub.next_billing_on; v_send := true; v_payments_left := 0;
  else
    -- Less than 72 hours before the next payment: that payment is still taken,
    -- and the membership ends after that month.
    v_effective := public._add_month(sub.next_billing_on); v_send := false; v_payments_left := 1;
  end if;

  update public.member_subscriptions
  set status = 'cancel_scheduled', cancel_requested_at = now(), cancel_requested_by = auth.uid(), cancel_effective_on = v_effective,
      next_billing_on = case when v_payments_left = 0 then null else next_billing_on end
  where id = sub.id;
  perform public._audit('subscription_cancel_requested', 'subscription', sub.id::text,
    jsonb_build_object('effective_on', v_effective, 'payments_left', v_payments_left, 'by_admin', sub.user_id <> auth.uid()));
  return jsonb_build_object('ok', true, 'subscription_id', sub.id, 'ends_on', v_effective,
                            'payments_left', v_payments_left, 'send_provider_cancel', v_send);
end;
$$;

-- Changed their mind, before the cancellation reached Square.
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
  set status = 'active', cancel_requested_at = null, cancel_requested_by = null, cancel_effective_on = null,
      next_billing_on = case when periods_paid < total_periods then coalesce(next_billing_on, current_period_ends_on) end
  where id = sub.id;
  perform public._audit('subscription_cancel_undone', 'subscription', sub.id::text, '{}');
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin: stop at the next payment date regardless of notice.
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
  v_effective := coalesce(sub.next_billing_on, sub.current_period_ends_on);
  update public.member_subscriptions
  set status = 'cancel_scheduled', cancel_requested_at = coalesce(cancel_requested_at, now()),
      cancel_requested_by = coalesce(cancel_requested_by, auth.uid()), cancel_effective_on = v_effective, next_billing_on = null
  where id = sub.id;
  perform public._audit('subscription_ended_by_studio', 'subscription', sub.id::text,
    jsonb_build_object('reason', p_reason, 'effective_on', v_effective, 'user_id', sub.user_id));
  return jsonb_build_object('ok', true, 'subscription_id', sub.id, 'ends_on', v_effective, 'payments_left', 0, 'send_provider_cancel', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds are made by admins only (create-refund edge function → Square).
-- ---------------------------------------------------------------------------
create or replace function public.admin_can_refund(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
begin
  perform public._require_admin();
  select * into pay from public.payments where id = p_payment_id;
  if not found then perform public._fail('payment_not_found'); end if;
  if pay.status <> 'succeeded' or pay.provider <> 'square' or pay.amount_cents <= 0 then perform public._fail('payment_not_refundable'); end if;
  return jsonb_build_object('payment_id', pay.id, 'amount_cents', pay.amount_cents, 'currency', pay.currency,
                            'provider_payment_ref', pay.provider_payment_ref, 'provider_payment_id', pay.provider_payment_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily: reminders before each payment and before the end, and closing
-- memberships whose last month is over.
-- ---------------------------------------------------------------------------
create or replace function public.queue_subscription_reminders()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._local_date(now());
  v_count int := 0;
  v_n int;
  sub public.member_subscriptions;
begin
  -- 5 days before a payment, so there's time to cancel (72 hours' notice).
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select s.user_id, 'subscription_renewing',
         jsonb_build_object('plan_name', s.plan_snapshot ->> 'plan_name', 'price_cents', (s.plan_snapshot ->> 'price_cents')::int,
                            'class_count', (s.plan_snapshot ->> 'class_count')::int, 'on', s.next_billing_on,
                            'month', s.periods_paid + 1, 'of', s.total_periods),
         format('subpay:%s:%s', s.id, s.next_billing_on)
  from public.member_subscriptions s
  where s.status in ('active', 'past_due') and s.next_billing_on is not null and s.next_billing_on - v_today between 0 and 5
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- 7 days before the last month ends: sign up again (and the reward, if earned).
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select s.user_id, 'subscription_ending',
         jsonb_build_object('plan_name', s.plan_snapshot ->> 'plan_name', 'on', coalesce(s.cancel_effective_on, s.current_period_ends_on),
                            'reward', s.periods_paid >= s.total_periods and s.cancel_requested_at is null),
         format('subend:%s:%s', s.id, coalesce(s.cancel_effective_on, s.current_period_ends_on))
  from public.member_subscriptions s
  where s.status in ('active', 'cancel_scheduled') and s.next_billing_on is null
    and coalesce(s.cancel_effective_on, s.current_period_ends_on) - v_today between 0 and 7
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_count := v_count + v_n;

  -- Finished memberships (Square's own "completed" event also does this).
  for sub in select * from public.member_subscriptions
             where status <> 'ended' and next_billing_on is null
               and coalesce(cancel_effective_on, current_period_ends_on) <= v_today
             for update
  loop
    update public.member_subscriptions set status = 'ended', end_reason = public._end_reason(sub), ended_at = now() where id = sub.id;
  end loop;
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
revoke execute on function public._add_month(date), public._end_of_day(date), public._close_membership(uuid, text),
  public._grant_membership(uuid, public.payments, jsonb, int, timestamptz, uuid, public.ledger_kind, text, text),
  public._issue_period(uuid, int, public.payments), public._grant_loyalty_reward(public.member_subscriptions, public.payments),
  public._start_subscription(public.payments), public._end_reason(public.member_subscriptions),
  public.mark_billing_synced(uuid), public.replace_provider_subscription(uuid, text), public.subscriptions_due_restart(),
  public.link_provider_subscription(uuid, text, text),
  public.fulfill_subscription_charge(text, text, text, int, text, timestamptz),
  public.subscription_charge_failed(text, text), public.subscription_provider_ended(text, text),
  public.mark_provider_cancel_sent(uuid), public.request_subscription_cancel(uuid), public.undo_subscription_cancel(uuid),
  public.admin_end_subscription_now(uuid, text), public.admin_can_refund(uuid), public.queue_subscription_reminders()
  from public, anon, authenticated;
grant execute on function public.request_subscription_cancel(uuid), public.undo_subscription_cancel(uuid),
  public.admin_end_subscription_now(uuid, text), public.admin_can_refund(uuid) to authenticated;
grant execute on function public.mark_billing_synced(uuid), public.replace_provider_subscription(uuid, text),
  public.subscriptions_due_restart(), public.link_provider_subscription(uuid, text, text),
  public.fulfill_subscription_charge(text, text, text, int, text, timestamptz),
  public.subscription_charge_failed(text, text), public.subscription_provider_ended(text, text),
  public.mark_provider_cancel_sent(uuid), public.queue_subscription_reminders() to service_role;
