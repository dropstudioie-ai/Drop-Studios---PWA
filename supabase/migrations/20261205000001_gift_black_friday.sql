-- Black Friday gift card bonuses (dates are settings, so they can be reused or extended):
--  * "Dance together": a gift card bought in the offer window lets the person who redeems it bring a friend
--    free to their first class (booked with that gift).
--  * "Buy 2, get a 3rd free": every 2 gift cards a buyer pays for in the window add a free 3-class Intro gift
--    for a third person. The buyer sends it by email or gives the printed card.
-- Also: a buyer can choose to collect a printed card at reception.

alter table public.app_settings
  add column if not exists gift_offer_from timestamptz default (timestamp '2026-11-27 00:00' at time zone 'Europe/Dublin'),
  add column if not exists gift_offer_to timestamptz default (timestamp '2026-12-02 00:00' at time zone 'Europe/Dublin'),
  add column if not exists gift_offer_friend boolean not null default true,
  add column if not exists gift_offer_buy2 boolean not null default true;

alter table public.gift_cards
  add column if not exists friend_free boolean not null default false,
  add column if not exists is_bonus boolean not null default false,
  add column if not exists collect_at_reception boolean not null default false,
  add column if not exists collected_at timestamptz;
alter table public.memberships
  add column if not exists friend_pass boolean not null default false,
  add column if not exists friend_pass_booking_id uuid;

-- The offer as the shop shows it (null outside the window).
create or replace function public.gift_offer()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when s.gift_offer_from is not null and now() >= s.gift_offer_from and now() < s.gift_offer_to
              and (s.gift_offer_friend or s.gift_offer_buy2)
    then jsonb_build_object('friend', s.gift_offer_friend, 'buy2', s.gift_offer_buy2, 'ends_at', s.gift_offer_to) end
  from public.app_settings s limit 1;
$$;
grant execute on function public.gift_offer() to anon, authenticated;

drop function if exists public.create_gift_checkout(uuid, text, text, text, date, text, public.payment_provider);
create or replace function public.create_gift_checkout(p_plan_id uuid, p_recipient_name text, p_recipient_email text,
  p_message text, p_send_on date, p_idempotency_key text, p_provider public.payment_provider, p_collect boolean default false)
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
    insert into public.gift_cards (code, plan_id, plan_snapshot, buyer_id, payment_id, recipient_name, recipient_email, message, send_on, collect_at_reception)
    values (public._gift_code(), p.id, v_snap, v_uid, pay.id, nullif(btrim(p_recipient_name), ''), v_email, nullif(btrim(p_message), ''), p_send_on, coalesce(p_collect, false));
  end if;
  return jsonb_build_object('payment_id', pay.id, 'status', pay.status, 'amount_cents', pay.amount_cents, 'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name', 'class_count', (pay.plan_snapshot ->> 'class_count')::int, 'provider', pay.provider,
    'provider_session_id', pay.provider_session_id, 'is_test', pay.is_test, 'superseded', '[]'::jsonb, 'plan_id', pay.plan_id,
    'billing_interval', 'one_off', 'commitment_months', null, 'kind', 'gift');
end;
$$;
revoke all on function public.create_gift_checkout(uuid, text, text, text, date, text, public.payment_provider, boolean) from public, anon;
grant execute on function public.create_gift_checkout(uuid, text, text, text, date, text, public.payment_provider, boolean) to authenticated;

-- Paid: the card becomes active, the buyer gets the code, the friend's email goes out if due, and the
-- Black Friday bonuses are applied.
create or replace function public._activate_gift_card(pay public.payments)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards;
  s public.app_settings := (select x from public.app_settings x limit 1);
  v_in_offer boolean;
  v_paid int; v_bonus int;
  p public.membership_plans; bp public.payments; bg public.gift_cards; v_snap jsonb;
begin
  update public.gift_cards set status = 'active', purchased_at = now(),
    expires_at = now() + make_interval(months => s.gift_card_validity_months)
  where payment_id = pay.id and status = 'pending_payment' returning * into g;
  if not found then
    select * into g from public.gift_cards where payment_id = pay.id;
    return jsonb_build_object('ok', true, 'gift_card_id', g.id);   -- already activated (repeat webhook)
  end if;
  v_in_offer := s.gift_offer_from is not null and g.purchased_at >= s.gift_offer_from and g.purchased_at < s.gift_offer_to;
  if v_in_offer and s.gift_offer_friend then
    update public.gift_cards set friend_free = true where id = g.id returning * into g;
  end if;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (g.buyer_id, 'gift_card_bought', jsonb_build_object('gift_card_id', g.id, 'code', g.code, 'plan_name', g.plan_snapshot ->> 'plan_name',
    'recipient_name', g.recipient_name, 'recipient_email', g.recipient_email, 'send_on', g.send_on, 'expires_at', g.expires_at,
    'friend_free', g.friend_free, 'collect', g.collect_at_reception),
    'gift_bought:' || g.id)
  on conflict (dedupe_key) do nothing;

  -- Buy 2, get a 3rd Intro gift free.
  if v_in_offer and s.gift_offer_buy2 then
    perform 1 from public.profiles where id = g.buyer_id for update;   -- one bonus at a time per buyer
    select count(*) filter (where not is_bonus), count(*) filter (where is_bonus) into v_paid, v_bonus
    from public.gift_cards where buyer_id = g.buyer_id and status in ('active', 'redeemed', 'expired')
      and purchased_at >= s.gift_offer_from and purchased_at < s.gift_offer_to;
    if v_paid / 2 > v_bonus then
      select * into p from public.membership_plans where code = 'intro-3';
      v_snap := jsonb_build_object('plan_id', p.id, 'plan_code', p.code, 'plan_name', p.name || ' (free gift)',
        'price_cents', 0, 'currency', p.currency, 'class_count', p.class_count, 'validity_days', p.validity_days,
        'style_access', p.style_access, 'all_styles', p.all_styles, 'billing_interval', 'one_off', 'gift', true, 'bonus', true);
      insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, idempotency_key, created_by, kind, status, completed_at)
      values (g.buyer_id, p.id, v_snap, 0, p.currency, 'manual', pay.is_test, 'gift-bonus:' || g.id, g.buyer_id, 'gift', 'succeeded', now())
      returning * into bp;
      insert into public.gift_cards (code, status, plan_id, plan_snapshot, buyer_id, payment_id, purchased_at, expires_at, is_bonus)
      values (public._gift_code(), 'active', p.id, v_snap, g.buyer_id, bp.id, now(), now() + make_interval(months => s.gift_card_validity_months), true)
      returning * into bg;
      insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
      values (g.buyer_id, 'gift_card_bonus', jsonb_build_object('gift_card_id', bg.id, 'code', bg.code, 'plan_name', bg.plan_snapshot ->> 'plan_name',
        'expires_at', bg.expires_at), 'gift_bonus:' || bg.id)
      on conflict (dedupe_key) do nothing;
      perform public._audit('gift_card_bonus', 'gift_card', bg.id::text, jsonb_build_object('for', g.id));
    end if;
  end if;

  perform public.queue_gift_card_emails();
  perform public._audit('gift_card_bought', 'gift_card', g.id::text, jsonb_build_object('payment_id', pay.id, 'plan', g.plan_snapshot ->> 'plan_name', 'friend_free', g.friend_free));
  return jsonb_build_object('ok', true, 'gift_card_id', g.id);
end;
$$;

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
  if g.friend_free then update public.memberships set friend_pass = true where id = v_membership; end if;
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

-- The friend's email says when they can bring someone free.
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
      'recipient_name', d.recipient_name, 'expires_at', d.expires_at, 'friend_free', d.friend_free),
    'gift_received:' || d.id, d.recipient_email, d.recipient_name
  from due d
  on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The buyer sends a gift card they haven't given yet (e.g. the free Intro gift) by email, now or on a chosen day.
create or replace function public.send_gift_card(p_gift_card_id uuid, p_recipient_name text, p_recipient_email text, p_message text, p_send_on date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  g public.gift_cards;
  v_email text := nullif(lower(btrim(p_recipient_email)), '');
begin
  select * into g from public.gift_cards where id = p_gift_card_id and buyer_id = auth.uid() for update;
  if not found then perform public._fail('gift_card_not_found'); end if;
  if g.status <> 'active' then perform public._fail('gift_card_not_active'); end if;
  if g.recipient_emailed_at is not null then perform public._fail('gift_card_already_sent'); end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then perform public._fail('invalid_email'); end if;
  if p_send_on is null or p_send_on < public._local_date(now()) or p_send_on > public._local_date(now()) + 365 then perform public._fail('invalid_send_date'); end if;
  if length(coalesce(p_message, '')) > 500 or length(coalesce(p_recipient_name, '')) > 80 then perform public._fail('too_long'); end if;
  update public.gift_cards set recipient_name = nullif(btrim(p_recipient_name), ''), recipient_email = v_email,
    message = nullif(btrim(p_message), ''), send_on = p_send_on where id = g.id;
  perform public.queue_gift_card_emails();
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.send_gift_card(uuid, text, text, text, date) from public, anon;
grant execute on function public.send_gift_card(uuid, text, text, text, date) to authenticated;

-- Reception hands over a printed card.
create or replace function public.admin_mark_gift_collected(p_gift_card_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  update public.gift_cards set collected_at = now() where id = p_gift_card_id and collect_at_reception;
  perform public._audit('gift_card_collected', 'gift_card', p_gift_card_id::text, '{}'::jsonb);
end;
$$;
revoke all on function public.admin_mark_gift_collected(uuid) from public, anon;
grant execute on function public.admin_mark_gift_collected(uuid) to authenticated;

-- Memberships that still have a free friend for their first class.
create or replace function public.my_friend_passes()
returns uuid[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(id), '{}') from public.memberships where user_id = auth.uid() and friend_pass;
$$;
grant execute on function public.my_friend_passes() to authenticated;

-- Book a class with a gift membership and bring a friend free (once). The friend takes a second spot.
create or replace function public.book_class_with_friend(p_session_id uuid, p_membership_id uuid, p_guest_name text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_guest text := nullif(btrim(coalesce(p_guest_name, '')), '');
  m public.memberships;
  r jsonb;
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if v_guest is null or length(v_guest) > 80 then perform public._fail('guest_name_required'); end if;
  select * into m from public.memberships where id = p_membership_id and user_id = v_uid for update;
  if not found or not m.friend_pass then perform public._fail('friend_offer_unavailable'); end if;
  r := public.book_class(p_session_id, p_membership_id);
  select * into s from public.class_sessions where id = p_session_id for update;
  if s.is_special then perform public._fail('friend_offer_unavailable'); end if;
  if s.booked_count + 1 > s.capacity then perform public._fail('not_enough_spots_for_friend'); end if;
  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;
  insert into public.session_guests (session_id, host_booking_id, host_user_id, guest_name)
  values (s.id, (r ->> 'booking_id')::uuid, v_uid, v_guest);
  update public.memberships set friend_pass = false, friend_pass_booking_id = (r ->> 'booking_id')::uuid where id = m.id;
  perform public._audit('friend_brought', 'booking', r ->> 'booking_id', jsonb_build_object('guest', v_guest, 'membership_id', m.id));
  return r || jsonb_build_object('guest_name', v_guest);
end;
$$;
revoke all on function public.book_class_with_friend(uuid, uuid, text) from public, anon;
grant execute on function public.book_class_with_friend(uuid, uuid, text) to authenticated;

-- Cancelling that booking gives the free friend back for another class.
create or replace function public._restore_friend_pass() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status in ('cancelled', 'late_cancelled') and old.status not in ('cancelled', 'late_cancelled') then
    update public.memberships set friend_pass = true, friend_pass_booking_id = null where friend_pass_booking_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_restore_friend_pass on public.bookings;
create trigger bookings_restore_friend_pass after update of status on public.bookings
  for each row execute function public._restore_friend_pass();
revoke execute on function public._restore_friend_pass(), public._activate_gift_card(public.payments) from public, anon, authenticated;
