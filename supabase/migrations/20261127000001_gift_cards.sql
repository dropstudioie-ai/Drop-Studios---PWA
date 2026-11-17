-- Digital gift cards: a member buys a specific pack for a friend (one month for monthly plans).
-- The friend gets the code by email on a chosen day and/or the buyer prints the card; it is redeemed
-- in the app or at reception and becomes a prepaid membership for whoever redeems it.

alter type public.payment_kind add value if not exists 'gift';

-- A gift payment is for a plan, like a membership (compared as text: the new enum value can't be used until committed).
alter table public.payments drop constraint if exists payments_kind_target;
alter table public.payments add constraint payments_kind_target check (
  ((kind::text in ('membership', 'gift')) and plan_id is not null and session_id is null)
  or ((kind::text in ('ticket', 'drop_in')) and session_id is not null and plan_id is null));

alter table public.app_settings add column if not exists gift_card_validity_months int not null default 60
  check (gift_card_validity_months between 1 and 120);

create table if not exists public.gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'active', 'redeemed', 'expired', 'cancelled')),
  plan_id uuid references public.membership_plans(id) on delete set null,
  plan_snapshot jsonb not null,               -- what was gifted, frozen at purchase
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  payment_id uuid unique references public.payments(id) on delete set null,
  recipient_name text,
  recipient_email text,
  message text,
  send_on date,                               -- day the email goes to the friend (null = buyer gives it in person)
  recipient_emailed_at timestamptz,
  purchased_at timestamptz,
  expires_at timestamptz,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_at timestamptz,
  membership_id uuid references public.memberships(id) on delete set null,
  redeemed_via text check (redeemed_via in ('app', 'reception')),
  created_at timestamptz not null default now()
);
create index if not exists gift_cards_buyer on public.gift_cards (buyer_id, created_at desc);
create index if not exists gift_cards_due on public.gift_cards (send_on) where status = 'active' and recipient_emailed_at is null;
alter table public.gift_cards enable row level security;
drop policy if exists gift_cards_read on public.gift_cards;
create policy gift_cards_read on public.gift_cards for select to authenticated
  using (buyer_id = auth.uid() or redeemed_by = auth.uid() or public.is_admin());
grant select on public.gift_cards to authenticated;

-- Messages can go to an address that isn't a member's (the friend receiving a gift card).
alter table public.notification_outbox add column if not exists to_email text, add column if not exists to_name text;
drop function if exists public.claim_notifications(int);
create function public.claim_notifications(p_limit int)
returns table (id bigint, user_id uuid, kind text, payload jsonb, email text, full_name text, direct boolean)
language plpgsql security definer set search_path = public, pg_temp as $fn$
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
    returning o.id, o.user_id, o.kind, o.payload, o.to_email, o.to_name
  )
  -- A message with its own address (e.g. a gift card for a friend) goes only there, by email.
  select c.id, c.user_id, c.kind, c.payload, coalesce(c.to_email, case when p.notify_email then p.email end),
         coalesce(c.to_name, p.full_name), c.to_email is not null
  from claimed c join public.profiles p on p.id = c.user_id;
end;
$fn$;
revoke all on function public.claim_notifications(int) from public, anon, authenticated;
grant execute on function public.claim_notifications(int) to service_role;

-- Easy to read aloud and type: no 0/O, 1/I/L.
create or replace function public._gift_code() returns text language plpgsql volatile set search_path = public, pg_temp as $$
declare
  a constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := 'DROP-';
    for i in 1..8 loop
      c := c || substr(a, 1 + floor(random() * length(a))::int, 1);
      if i = 4 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.gift_cards where code = c);
  end loop;
  return c;
end;
$$;

-- What can be gifted: public, active packs (not private plans). Monthly plans are gifted as one month.
create or replace function public.giftable_plans()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'code', p.code, 'name', p.name,
      'gift_name', case when p.billing_interval = 'monthly' then p.name || ' · 1 month' else p.name end,
      'price_cents', p.price_cents, 'currency', p.currency, 'class_count', p.class_count,
      'validity_days', p.validity_days, 'style_access', p.style_access, 'monthly', p.billing_interval = 'monthly',
      'first_time_only', p.first_time_only) order by p.sort_order), '[]')
  from public.membership_plans p where p.is_active and p.visibility = 'public';
$$;
grant execute on function public.giftable_plans() to anon, authenticated;

create or replace function public.create_gift_checkout(p_plan_id uuid, p_recipient_name text, p_recipient_email text,
  p_message text, p_send_on date, p_idempotency_key text, p_provider public.payment_provider)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  p public.membership_plans;
  pay public.payments;
  v_snap jsonb;
  v_email text := nullif(lower(btrim(p_recipient_email)), '');
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_provider not in ('square', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email'); end if;
  if v_email is not null and p_send_on is null then perform public._fail('send_date_required'); end if;
  if p_send_on is not null and (p_send_on < public._local_date(now()) or p_send_on > public._local_date(now()) + 365) then perform public._fail('invalid_send_date'); end if;
  if length(coalesce(p_message, '')) > 500 or length(coalesce(p_recipient_name, '')) > 80 then perform public._fail('too_long'); end if;

  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if not found then
    select * into p from public.membership_plans where id = p_plan_id and is_active and visibility = 'public';
    if not found then perform public._fail('plan_unavailable'); end if;
    v_snap := jsonb_build_object(
      'plan_id', p.id, 'plan_code', p.code,
      'plan_name', case when p.billing_interval = 'monthly' then p.name || ' · 1 month (gift)' else p.name || ' (gift)' end,
      'price_cents', p.price_cents, 'currency', p.currency, 'class_count', p.class_count,
      'validity_days', p.validity_days, 'style_access', p.style_access, 'all_styles', p.all_styles,
      'billing_interval', 'one_off', 'gift', true);
    insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, idempotency_key, created_by, kind)
    values (v_uid, p.id, v_snap, p.price_cents, p.currency, p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid, 'gift')
    returning * into pay;
    insert into public.gift_cards (code, plan_id, plan_snapshot, buyer_id, payment_id, recipient_name, recipient_email, message, send_on)
    values (public._gift_code(), p.id, v_snap, v_uid, pay.id, nullif(btrim(p_recipient_name), ''), v_email, nullif(btrim(p_message), ''), p_send_on);
  end if;
  return jsonb_build_object('payment_id', pay.id, 'status', pay.status, 'amount_cents', pay.amount_cents, 'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name', 'class_count', (pay.plan_snapshot ->> 'class_count')::int, 'provider', pay.provider,
    'provider_session_id', pay.provider_session_id, 'is_test', pay.is_test, 'superseded', '[]'::jsonb, 'plan_id', pay.plan_id,
    'billing_interval', 'one_off', 'commitment_months', null, 'kind', 'gift');
end;
$$;
revoke all on function public.create_gift_checkout(uuid, text, text, text, date, text, public.payment_provider) from public, anon;
grant execute on function public.create_gift_checkout(uuid, text, text, text, date, text, public.payment_provider) to authenticated;

-- Paid: the card becomes active, the buyer gets the code, and the friend's email is sent if it's due.
create or replace function public._activate_gift_card(pay public.payments)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards;
begin
  update public.gift_cards set status = 'active', purchased_at = now(),
    expires_at = now() + make_interval(months => (select gift_card_validity_months from public.app_settings limit 1))
  where payment_id = pay.id and status = 'pending_payment' returning * into g;
  if not found then select * into g from public.gift_cards where payment_id = pay.id; end if;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (g.buyer_id, 'gift_card_bought', jsonb_build_object('gift_card_id', g.id, 'code', g.code, 'plan_name', g.plan_snapshot ->> 'plan_name',
    'recipient_name', g.recipient_name, 'recipient_email', g.recipient_email, 'send_on', g.send_on, 'expires_at', g.expires_at),
    'gift_bought:' || g.id)
  on conflict (dedupe_key) do nothing;
  perform public.queue_gift_card_emails();
  perform public._audit('gift_card_bought', 'gift_card', g.id::text, jsonb_build_object('payment_id', pay.id, 'plan', g.plan_snapshot ->> 'plan_name'));
  return jsonb_build_object('ok', true, 'gift_card_id', g.id);
end;
$$;

-- Friends' emails due today (run by pg_cron every hour, and straight after payment).
create or replace function public.queue_gift_card_emails()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  with due as (
    update public.gift_cards g set recipient_emailed_at = now()
    where g.status = 'active' and g.recipient_email is not null and g.recipient_emailed_at is null
      and g.send_on <= public._local_date(now())
    returning g.*
  )
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key, to_email, to_name)
  select d.buyer_id, 'gift_card_received', jsonb_build_object('code', d.code, 'plan_name', d.plan_snapshot ->> 'plan_name',
      'from_name', (select full_name from public.profiles where id = d.buyer_id), 'message', d.message,
      'recipient_name', d.recipient_name, 'expires_at', d.expires_at),
    'gift_received:' || d.id, d.recipient_email, d.recipient_name
  from due d
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.queue_gift_card_emails() from public, anon, authenticated;

-- Look a code up before redeeming (what it is, whether it can be used). Never shows who bought it.
create or replace function public.gift_card_lookup(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into g from public.gift_cards where code = upper(btrim(p_code));
  if not found or g.status = 'pending_payment' then perform public._fail('gift_card_not_found'); end if;
  return jsonb_build_object('code', g.code, 'plan_name', g.plan_snapshot ->> 'plan_name', 'class_count', (g.plan_snapshot ->> 'class_count')::int,
    'validity_days', (g.plan_snapshot ->> 'validity_days')::int, 'style_access', g.plan_snapshot ->> 'style_access',
    'status', case when g.status = 'active' and g.expires_at <= now() then 'expired' else g.status end,
    'expires_at', g.expires_at, 'recipient_name', g.recipient_name,
    'styles', case when g.plan_snapshot ->> 'style_access' = 'single' then (
      select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order), '[]') from public.dance_styles d
      where d.is_active and (coalesce((g.plan_snapshot ->> 'all_styles')::boolean, true)
        or d.id in (select style_id from public.plan_styles where plan_id = g.plan_id))) end);
end;
$$;
grant execute on function public.gift_card_lookup(text) to authenticated;

create or replace function public._redeem_gift_card(p_code text, p_user_id uuid, p_style_id uuid, p_via text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards;
  pay public.payments;
  v_snap jsonb;
  v_allowed uuid[];
  v_membership uuid;
  v_days int;
begin
  select * into g from public.gift_cards where code = upper(btrim(p_code)) for update;
  if not found or g.status = 'pending_payment' then perform public._fail('gift_card_not_found'); end if;
  if g.status = 'redeemed' then perform public._fail('gift_card_used'); end if;
  if g.status <> 'active' then perform public._fail('gift_card_not_active'); end if;
  if g.expires_at <= now() then perform public._fail('gift_card_expired'); end if;
  select * into pay from public.payments where id = g.payment_id;

  if coalesce((g.plan_snapshot ->> 'all_styles')::boolean, true) then
    select coalesce(array_agg(id order by sort_order), '{}') into v_allowed from public.dance_styles where is_active;
  else
    select coalesce(array_agg(ds.id order by ds.sort_order), '{}') into v_allowed
    from public.plan_styles ps join public.dance_styles ds on ds.id = ps.style_id where ps.plan_id = g.plan_id and ds.is_active;
  end if;
  if g.plan_snapshot ->> 'style_access' = 'single' then
    if p_style_id is null then perform public._fail('style_required'); end if;
    if not (p_style_id = any (v_allowed)) then perform public._fail('style_not_eligible'); end if;
    v_allowed := array[p_style_id];
  else
    p_style_id := null;
  end if;
  v_snap := g.plan_snapshot || jsonb_build_object('selected_style_id', p_style_id, 'allowed_style_ids', to_jsonb(v_allowed),
    'excluded_template_ids', coalesce((select jsonb_agg(template_id) from public.plan_exclusions where plan_id = g.plan_id and template_id is not null), '[]'));
  v_days := greatest(1, coalesce((g.plan_snapshot ->> 'validity_days')::int, 30));

  v_membership := public._grant_membership(p_user_id, pay, v_snap, (g.plan_snapshot ->> 'class_count')::int,
    public.compute_expiry(now(), v_days, 0), null, 'grant_purchase', 'Gift card ' || g.code, g.plan_snapshot ->> 'plan_name');
  update public.gift_cards set status = 'redeemed', redeemed_by = p_user_id, redeemed_at = now(), membership_id = v_membership, redeemed_via = p_via
  where id = g.id;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (g.buyer_id, 'gift_card_redeemed', jsonb_build_object('plan_name', g.plan_snapshot ->> 'plan_name',
    'recipient_name', coalesce((select full_name from public.profiles where id = p_user_id), g.recipient_name)), 'gift_redeemed:' || g.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit('gift_card_redeemed', 'gift_card', g.id::text, jsonb_build_object('user_id', p_user_id, 'via', p_via, 'membership_id', v_membership));
  return jsonb_build_object('ok', true, 'membership_id', v_membership, 'plan_name', g.plan_snapshot ->> 'plan_name');
end;
$$;
revoke all on function public._redeem_gift_card(text, uuid, uuid, text) from public, anon, authenticated;

-- The member redeems a code in the app.
create or replace function public.redeem_gift_card(p_code text, p_style_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  return public._redeem_gift_card(p_code, auth.uid(), p_style_id, 'app');
end;
$$;
revoke all on function public.redeem_gift_card(text, uuid) from public, anon;
grant execute on function public.redeem_gift_card(text, uuid) to authenticated;

-- Reception redeems a printed card for a member.
create or replace function public.admin_redeem_gift_card(p_code text, p_user_id uuid, p_style_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return public._redeem_gift_card(p_code, p_user_id, p_style_id, 'reception');
end;
$$;
revoke all on function public.admin_redeem_gift_card(text, uuid, uuid) from public, anon;
grant execute on function public.admin_redeem_gift_card(text, uuid, uuid) to authenticated;

create or replace function public.fulfill_payment(p_payment_id uuid, p_provider public.payment_provider, p_provider_ref text,
  p_provider_event_id text, p_amount_cents integer, p_currency text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  pay public.payments;
  v_membership_id uuid;
  v_was_cancelled boolean;
  v_sub jsonb;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;

  if pay.status = 'succeeded' then
    if pay.kind::text = 'gift' then
      return jsonb_build_object('ok', true, 'gift_card_id', (select id from public.gift_cards where payment_id = pay.id), 'duplicate', true);
    end if;
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

  if pay.kind::text = 'gift' then
    return public._activate_gift_card(pay) || jsonb_build_object('duplicate', false);
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
$fn$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('drop-gift-card-emails') where exists (select 1 from cron.job where jobname = 'drop-gift-card-emails');
    perform cron.schedule('drop-gift-card-emails', '3 * * * *', 'select public.queue_gift_card_emails()');
  end if;
end $$;

-- Thamires knows about gift cards.
create or replace function public.assistant_knowledge()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'today', to_char(now() at time zone 'Europe/Dublin', 'FMDay DD FMMonth YYYY'),
    'studio', jsonb_build_object('name', 'Drop Studios', 'address', '13 Sackville Place, Dublin 1, D01 (city centre, near O''Connell Street)',
      'website', 'https://www.dropstudios.ie', 'email', 'dropstudioie@gmail.com'),
    'policies', (select jsonb_build_object(
        'booking_window_days', s.booking_window_days,
        'free_cancellation_minutes_before', s.cancellation_cutoff_minutes,
        'bring_a_friend', 'First-time customers buying a Drop In can bring a friend free (2 spots for the price of one).',
        'first_class', 'New members can book their first class without a profile photo; we take it at reception.',
        'payments', 'Card, Apple Pay and Google Pay, online through Square.',
        'gift_cards', 'Digital gift cards for any Drop pack (monthly plans are gifted as one month). Buy at https://www.dropstudios.ie/gift: add a personal message and choose the day it is emailed, or print it and give it in person. Redeem in the app at https://www.dropstudios.ie/gift/redeem or at reception. Valid for 5 years.',
        'app', 'The Drop app works in any phone browser and can be added to the home screen (no app store): https://www.dropstudios.ie/app')
      from public.app_settings s limit 1),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'label', p.display_label, 'price_eur', p.price_cents / 100.0,
        'classes', p.class_count, 'first_time_only', p.first_time_only, 'link', 'https://www.dropstudios.ie/checkout/' || p.code) order by p.sort_order), '[]')
      from public.membership_plans p where p.is_active and p.visibility = 'public'),
    'styles', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'level', d.level, 'description', d.description,
        'what_to_wear', d.what_to_wear, 'what_to_bring', d.what_to_bring, 'first_class', d.first_class,
        'drop_in_eur', d.drop_in_price_cents / 100.0, 'page', 'https://www.dropstudios.ie/classes/' || d.slug) order by d.sort_order), '[]')
      from public.dance_styles d where d.is_active),
    'next_14_days', (select coalesce(jsonb_agg(jsonb_build_object(
        'when', to_char(s.starts_at at time zone 'Europe/Dublin', 'Dy DD Mon HH24:MI'),
        'class', s.title, 'style', d.name, 'instructor', i.full_name,
        'availability', public._availability(s.capacity, s.booked_count),
        'special', (select e.title from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1),
        'book', 'https://www.dropstudios.ie/timetable?class=' || s.id) order by s.starts_at), '[]')
      from public.class_sessions s left join public.dance_styles d on d.id = s.style_id left join public.instructors i on i.id = s.instructor_id
      where s.status = 'scheduled' and s.starts_at > now() and s.starts_at < now() + interval '14 days'),
    'notes', (select notes from public.assistant_settings),
    'owner_guidance', (select coalesce(jsonb_agg(jsonb_build_object('question', g.question, 'answer', g.answer) order by g.answered_at desc), '[]')
      from (select question, answer, answered_at from public.assistant_guidance where status = 'answered' order by answered_at desc limit 60) g));
$fn$;
revoke all on function public.assistant_knowledge() from public, anon, authenticated;
grant execute on function public.assistant_knowledge() to service_role;
