-- Drop Studios — mobile number required, one Intro Offer per mobile number,
-- 5-minute payment holds, and members' contact details for instructors.

-- ---------------------------------------------------------------------------
-- Mobile numbers: one comparable form (Irish numbers as 353…, others digits only)
-- ---------------------------------------------------------------------------
create or replace function public._phone_key(p text)
returns text
language sql
immutable
as $$
  select case
    when d is null or length(d) < 7 then null
    when d like '00%' then substr(d, 3)
    when d like '0%' then '353' || substr(d, 2)
    else d
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x;
$$;

alter table public.profiles add column if not exists phone_key text generated always as (public._phone_key(phone)) stored;
create index if not exists profiles_phone_key_idx on public.profiles (phone_key) where phone_key is not null;

-- Profiles of other accounts with the same mobile number (admins only).
create or replace function public.admin_shared_phone(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'full_name', o.full_name, 'email', o.email) order by o.created_at), '[]'::jsonb)
    from public.profiles me join public.profiles o on o.phone_key = me.phone_key and o.id <> me.id
    where me.id = p_user_id and me.phone_key is not null
  );
end;
$$;

-- Accounts whose mobile number is shared with another account (admins only).
create or replace function public.admin_shared_phone_users()
returns uuid[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return (select coalesce(array_agg(id), '{}') from public.profiles p
          where phone_key is not null and exists (select 1 from public.profiles o where o.phone_key = p.phone_key and o.id <> p.id));
end;
$$;

-- The Intro Offer is for new people: no earlier purchase on this account, or on
-- any other account with the same mobile number.
create or replace function public.is_first_time_customer(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.membership_purchases mp
    where mp.user_id = coalesce(p_user_id, auth.uid())
       or mp.user_id in (
         select o.id from public.profiles me join public.profiles o on o.phone_key = me.phone_key
         where me.id = coalesce(p_user_id, auth.uid()) and me.phone_key is not null)
  );
$$;

-- Members need a mobile number before paying for anything in the app.
create or replace function public._require_phone_for_checkout()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending' and new.user_id = auth.uid() and new.provider <> 'manual'
     and not exists (select 1 from public.profiles where id = new.user_id and phone_key is not null) then
    perform public._fail('phone_required');
  end if;
  return new;
end;
$$;
drop trigger if exists payments_require_phone on public.payments;
create trigger payments_require_phone before insert on public.payments
  for each row execute function public._require_phone_for_checkout();

-- ---------------------------------------------------------------------------
-- Payment holds: 5 minutes, released every minute
-- ---------------------------------------------------------------------------
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
  cfg public.app_settings := public._settings();
  s public.class_sessions;
  pay public.payments;
  v_booking_id uuid;
  v_kind public.payment_kind;
  v_price int;
  v_label text;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(v_uid) then perform public._fail('profile_photo_required'); end if;
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

    if s.is_special then
      v_kind := 'ticket';
      v_price := case when s.member_ticket_price_cents is not null and public._is_member(v_uid)
                      then s.member_ticket_price_cents else s.ticket_price_cents end;
      v_label := 'Ticket: ';
      if v_price is null then perform public._fail('tickets_not_available'); end if;
    else
      v_kind := 'drop_in';
      select drop_in_price_cents into v_price from public.dance_styles where id = s.style_id;
      v_label := 'Drop In: ';
      if v_price is null then perform public._fail('drop_in_not_available'); end if;
      if s.starts_at > now() + make_interval(days => cfg.booking_window_days) then
        perform public._fail('outside_booking_window');
      end if;
    end if;
    if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;
    if s.starts_at <= now() then perform public._fail('session_started'); end if;
    if exists (
      select 1 from public.bookings where user_id = v_uid and session_id = s.id
        and status in ('booked', 'attended', 'no_show', 'pending_payment')
    ) then perform public._fail('already_booked'); end if;
    if s.booked_count >= s.capacity then perform public._fail('session_full'); end if;

    insert into public.bookings (user_id, session_id, status, hold_expires_at)
    values (v_uid, s.id, 'pending_payment', now() + interval '5 minutes')
    returning id into v_booking_id;
    update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

    insert into public.payments (
      user_id, kind, session_id, booking_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, v_kind, s.id, v_booking_id,
      jsonb_build_object('kind', v_kind, 'plan_name', v_label || s.title, 'title', s.title,
                         'starts_at', s.starts_at, 'price_cents', v_price, 'currency', 'EUR'),
      v_price, 'EUR', p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid
    ) returning * into pay;
    update public.bookings set payment_id = pay.id where id = v_booking_id;
  elsif pay.session_id is distinct from p_session_id then
    perform public._fail('idempotency_conflict');
  end if;

  return jsonb_build_object(
    'payment_id', pay.id,
    'kind', pay.kind,
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

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('drop-release-holds') where exists (select 1 from cron.job where jobname = 'drop-release-holds');
    perform cron.schedule('drop-release-holds', '* * * * *', $job$select public.release_expired_holds()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Instructors see members' email and mobile (class lists and member search)
-- ---------------------------------------------------------------------------
create or replace function public._staff_roster(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  v_day date;
begin
  if auth.uid() is null or not public.can_staff_session(p_session_id) then perform public._fail('forbidden'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found then perform public._fail('session_not_found'); end if;
  v_day := public._local_date(s.starts_at);
  return jsonb_build_object(
    'session_id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
    'capacity', s.capacity, 'booked_count', s.booked_count, 'status', s.status,
    'bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'booking_id', b.id, 'user_id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path,
          'email', p.email, 'phone', p.phone,
          'status', b.status, 'class_restored', b.class_restored, 'booked_at', b.booked_at,
          'kind', coalesce(pay.kind::text, 'membership'),
          'plan_name', m.plan_name,
          'is_new', public._is_new_member(p.id, s.starts_at),
          'is_birthday', public._birthday_on(p.date_of_birth, v_day),
          'turning', case when public._birthday_on(p.date_of_birth, v_day)
                          then date_part('year', age(v_day, p.date_of_birth))::int end
        ) order by (b.status = 'pending_payment'), p.full_name), '[]'::jsonb)
      from public.bookings b
      join public.profiles p on p.id = b.user_id
      left join public.memberships m on m.id = b.membership_id
      left join public.payments pay on pay.id = b.payment_id
      where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show', 'pending_payment')
    )
  );
end;
$$;

create or replace function public.staff_find_members(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := btrim(coalesce(p_query, ''));
  k text := public._phone_key(p_query);
begin
  if auth.uid() is null or not public.is_staff() then perform public._fail('forbidden'); end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone, 'avatar_path', p.avatar_path)
                              order by p.full_name), '[]'::jsonb)
    from (
      select * from public.profiles
      where full_name ilike q or email ilike q or (k is not null and phone_key like '%' || k || '%')
      order by full_name limit 12
    ) p
  );
end;
$$;

revoke execute on function public._require_phone_for_checkout() from public, anon, authenticated;
grant execute on function public._phone_key(text) to anon, authenticated;  -- used by the profiles.phone_key column
revoke execute on function public.admin_shared_phone(uuid), public.admin_shared_phone_users() from public, anon;
grant execute on function public.admin_shared_phone(uuid), public.admin_shared_phone_users() to authenticated;
