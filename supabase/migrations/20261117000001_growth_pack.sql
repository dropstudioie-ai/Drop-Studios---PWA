-- Drop Studios — growth pack.
-- 1. First class without a profile photo (photo needed from the second booking).
-- 2. Bring a friend free: first-timers buying a Drop In bring a friend for the price of one.
-- 3. Manager admins: everything except revenue, payments, refunds, earnings and roles.
-- 4. Class feedback: after a member's first class in a style, every 6th class in a
--    style, and after events.
-- 5. Instructor birthdays: members booked into their classes get a heads-up a week
--    before and on the day.

-- ---------------------------------------------------------------------------
-- 1. Photo: required from the second booking
-- ---------------------------------------------------------------------------
create or replace function public._has_photo_file(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from storage.objects
    where bucket_id = 'avatars' and (storage.foldername(name))[1] = coalesce(p_user_id, auth.uid())::text
  );
$$;

-- "Photo requirement met": a photo, or no class booked yet (the first one is fine;
-- reception takes the photo).
create or replace function public.has_profile_photo(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public._has_photo_file(p_user_id) or not exists (
    select 1 from public.bookings
    where user_id = coalesce(p_user_id, auth.uid()) and status in ('booked', 'attended', 'no_show', 'late_cancelled', 'pending_payment')
  );
$$;
revoke execute on function public._has_photo_file(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bring a friend free (first Drop In)
-- ---------------------------------------------------------------------------
create table public.session_guests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  host_booking_id uuid not null unique references public.bookings (id) on delete cascade,
  host_user_id uuid not null references public.profiles (id) on delete cascade,
  guest_name text not null check (length(guest_name) between 1 and 80),
  created_at timestamptz not null default now()
);
alter table public.session_guests enable row level security;
create policy session_guests_read on public.session_guests for select to authenticated
  using (host_user_id = auth.uid() or public.is_admin());
revoke all on public.session_guests from anon, authenticated;
grant select on public.session_guests to authenticated;

-- First time at the studio: never booked a class and never bought anything.
create or replace function public.friend_offer_ok(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(p_user_id, auth.uid()) is not null
    and public.is_first_time_customer(coalesce(p_user_id, auth.uid()))
    and not exists (
      select 1 from public.bookings
      where user_id = coalesce(p_user_id, auth.uid()) and status in ('booked', 'attended', 'no_show', 'late_cancelled', 'pending_payment'))
    and not exists (
      select 1 from public.payments
      where user_id = coalesce(p_user_id, auth.uid()) and status = 'succeeded' and amount_cents > 0);
$$;

-- When the friend offer can be used for this class (for the booking screen).
create or replace function public.friend_offer(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.friend_offer_ok() and exists (
    select 1 from public.class_sessions s
    where s.id = p_session_id and s.status = 'scheduled' and not s.is_special and s.starts_at > now()
      and s.booked_count + 2 <= s.capacity);
$$;

drop function if exists public.create_ticket_checkout(uuid, text, public.payment_provider);
create function public.create_ticket_checkout(
  p_session_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'square',
  p_guest_name text default null
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
  v_guest text;
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
    v_guest := nullif(btrim(coalesce(p_guest_name, '')), '');
    if v_guest is not null then
      if v_kind <> 'drop_in' or not public.friend_offer_ok(v_uid) then perform public._fail('friend_offer_not_eligible'); end if;
      if s.booked_count + 2 > s.capacity then perform public._fail('no_space_for_friend'); end if;
    end if;

    insert into public.bookings (user_id, session_id, status, hold_expires_at)
    values (v_uid, s.id, 'pending_payment', now() + interval '5 minutes')
    returning id into v_booking_id;
    update public.class_sessions set booked_count = booked_count + 1 + (v_guest is not null)::int where id = s.id;
    if v_guest is not null then
      insert into public.session_guests (session_id, host_booking_id, host_user_id, guest_name)
      values (s.id, v_booking_id, v_uid, v_guest);
    end if;

    insert into public.payments (
      user_id, kind, session_id, booking_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, v_kind, s.id, v_booking_id,
      jsonb_build_object('kind', v_kind, 'plan_name', v_label || s.title || case when v_guest is not null then ' + friend free' else '' end, 'title', s.title, 'guest_name', v_guest,
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

-- The friend's spot goes when the host's booking is cancelled or released.
create or replace function public._release_guest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare g public.session_guests;
begin
  if old.status in ('booked', 'pending_payment') and new.status in ('cancelled', 'late_cancelled') then
    delete from public.session_guests where host_booking_id = new.id returning * into g;
    if found then
      update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = g.session_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger bookings_release_guest after update of status on public.bookings
  for each row execute function public._release_guest();

-- Class list shows the friend.
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
          'guest_name', (select g.guest_name from public.session_guests g where g.host_booking_id = b.id),
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

-- ---------------------------------------------------------------------------
-- 3. Manager admins (no financial information)
-- ---------------------------------------------------------------------------
alter table public.profiles add column finance_access boolean not null default false;
update public.profiles set finance_access = true where role = 'admin';

create or replace function public.can_view_finance()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and finance_access);
$$;
create or replace function public._require_finance()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if not public.can_view_finance() then perform public._fail('finance_only'); end if;
end;
$$;

drop policy payments_own on public.payments;
create policy payments_own on public.payments for select to authenticated
  using (user_id = auth.uid() or public.can_view_finance());

alter function public.admin_analytics(date, date) rename to _admin_analytics;
create function public.admin_analytics(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); return public._admin_analytics(p_from, p_to); end; $$;
alter function public.admin_ticket_sales(date, date) rename to _admin_ticket_sales;
create function public.admin_ticket_sales(p_from date, p_to date) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); return public._admin_ticket_sales(p_from, p_to); end; $$;
alter function public.admin_can_refund(uuid) rename to _admin_can_refund;
create function public.admin_can_refund(p_payment_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); return public._admin_can_refund(p_payment_id); end; $$;
alter function public.admin_cancel_checkout(uuid) rename to _admin_cancel_checkout;
create function public.admin_cancel_checkout(p_payment_id uuid) returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); return public._admin_cancel_checkout(p_payment_id); end; $$;
alter function public.admin_resolve_payment_review(uuid, text) rename to _admin_resolve_payment_review;
create function public.admin_resolve_payment_review(p_payment_id uuid, p_note text) returns void language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); perform public._admin_resolve_payment_review(p_payment_id, p_note); end; $$;
-- Only full admins change roles (so a manager can't promote or demote admins).
alter function public.admin_set_role(uuid, public.user_role) rename to _admin_set_role;
create function public.admin_set_role(p_user_id uuid, p_role public.user_role) returns void language plpgsql security definer set search_path = public, pg_temp
as $$ begin perform public._require_finance(); perform public._admin_set_role(p_user_id, p_role); end; $$;

alter function public.admin_dashboard() rename to _admin_dashboard;
create function public.admin_dashboard() returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare d jsonb := public._admin_dashboard();
begin
  if public.can_view_finance() then return d || jsonb_build_object('finance', true); end if;
  return (d - 'revenue_week_cents' - 'payments_week' - 'payments_to_review' - 'unfinished_checkouts' - 'ticket_refunds')
         || jsonb_build_object('finance', false);
end;
$$;
alter function public.admin_events() rename to _admin_events;
create function public.admin_events() returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare d jsonb := public._admin_events();
begin
  if public.can_view_finance() then return d; end if;
  return (select coalesce(jsonb_agg(e - 'ticket_revenue_cents' - 'fees_cents' - 'net_revenue_cents' - 'instructor_earnings_cents' - 'studio_earnings_cents'), '[]'::jsonb)
          from jsonb_array_elements(d) e);
end;
$$;

-- Full admin: give or remove a manager (admin without finance).
create or replace function public.admin_set_access(p_user_id uuid, p_level text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_finance();
  if p_user_id = auth.uid() then perform public._fail('cannot_change_own_access'); end if;
  if p_level not in ('full_admin', 'manager') then perform public._fail('invalid_level'); end if;
  update public.profiles set role = 'admin', finance_access = (p_level = 'full_admin') where id = p_user_id;
  if not found then perform public._fail('member_not_found'); end if;
  perform public._audit('access_changed', 'profile', p_user_id::text, jsonb_build_object('level', p_level));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Class feedback
-- ---------------------------------------------------------------------------
create table public.class_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  session_id uuid not null references public.class_sessions (id) on delete cascade,
  instructor_id uuid references public.instructors (id) on delete set null,
  style_id uuid references public.dance_styles (id),
  event_id uuid references public.studio_events (id) on delete set null,
  reason text not null check (reason in ('first_in_style', 'every_6', 'event')),
  status text not null default 'pending' check (status in ('pending', 'done')),
  rating smallint check (rating between 1 and 5),
  comment text check (length(comment) <= 1000),
  share_ok boolean not null default false,
  requested_at timestamptz not null default now(),
  answered_at timestamptz
);
create index class_feedback_session_idx on public.class_feedback (session_id);
create index class_feedback_instructor_idx on public.class_feedback (instructor_id, answered_at desc);
alter table public.class_feedback enable row level security;
create policy class_feedback_own on public.class_feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke all on public.class_feedback from anon, authenticated;
grant select on public.class_feedback to authenticated;

-- Runs every 15 minutes: ask for feedback about an hour after class.
create or replace function public.queue_feedback_requests()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_n int := 0;
  v_count int;
  v_event uuid;
  v_reason text;
  v_id uuid;
begin
  for r in
    select b.id booking_id, b.user_id, s.id session_id, s.title, s.starts_at, s.instructor_id, s.style_id,
           i.full_name instructor
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    join public.profiles p on p.id = b.user_id and p.role = 'customer'
    left join public.instructors i on i.id = s.instructor_id
    where b.status in ('booked', 'attended') and not coalesce(b.staff_free, false)
      and s.status = 'scheduled'
      and s.ends_at < now() - interval '1 hour' and s.ends_at > now() - interval '2 days'
      and not exists (select 1 from public.class_feedback f where f.booking_id = b.id)
  loop
    select e.id into v_event from public.studio_events e where e.session_id = r.session_id and e.status = 'published' limit 1;
    select count(*) into v_count from public.bookings b2 join public.class_sessions s2 on s2.id = b2.session_id
    where b2.user_id = r.user_id and b2.status in ('booked', 'attended') and s2.style_id = r.style_id and s2.starts_at <= r.starts_at;
    v_reason := case when v_event is not null then 'event' when v_count = 1 then 'first_in_style'
                     when v_count > 0 and v_count % 6 = 0 then 'every_6' end;
    if v_reason is null then continue; end if;
    insert into public.class_feedback (user_id, booking_id, session_id, instructor_id, style_id, event_id, reason)
    values (r.user_id, r.booking_id, r.session_id, r.instructor_id, r.style_id, v_event, v_reason)
    returning id into v_id;
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (r.user_id, 'feedback_request', jsonb_build_object('feedback_id', v_id, 'title', r.title, 'starts_at', r.starts_at,
            'instructor', r.instructor, 'reason', v_reason), 'feedback:' || v_id)
    on conflict (dedupe_key) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.submit_feedback(p_feedback_id uuid, p_rating int, p_comment text default null, p_share_ok boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare f public.class_feedback;
begin
  select * into f from public.class_feedback where id = p_feedback_id for update;
  if not found or f.user_id <> auth.uid() then perform public._fail('feedback_not_found'); end if;
  if f.status = 'done' then perform public._fail('feedback_already_sent'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform public._fail('invalid_rating'); end if;
  update public.class_feedback set status = 'done', rating = p_rating, comment = nullif(btrim(coalesce(p_comment, '')), ''),
    share_ok = coalesce(p_share_ok, false), answered_at = now() where id = f.id;
end;
$$;

create or replace function public.my_feedback_requests()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'reason', f.reason, 'title', s.title, 'starts_at', s.starts_at,
           'instructor', (select full_name from public.instructors where id = f.instructor_id),
           'style', (select name from public.dance_styles where id = f.style_id)) order by s.starts_at desc), '[]'::jsonb)
  from public.class_feedback f join public.class_sessions s on s.id = f.session_id
  where f.user_id = auth.uid() and f.status = 'pending' and f.requested_at > now() - interval '30 days';
$$;

-- Instructors see their own classes' feedback without names; admins see everything.
create or replace function public.staff_feedback(p_days int default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_admin boolean := public.is_admin(); v_instr uuid := public._my_instructor_id();
begin
  if auth.uid() is null or not (v_admin or v_instr is not null) then perform public._fail('forbidden'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'rating', f.rating, 'comment', f.comment, 'reason', f.reason, 'share_ok', f.share_ok, 'answered_at', f.answered_at,
      'title', s.title, 'starts_at', s.starts_at,
      'instructor', (select full_name from public.instructors where id = f.instructor_id),
      'style', (select name from public.dance_styles where id = f.style_id),
      'member', case when v_admin then (select full_name from public.profiles where id = f.user_id) end
    ) order by f.answered_at desc), '[]'::jsonb)
    from public.class_feedback f join public.class_sessions s on s.id = f.session_id
    where f.status = 'done' and f.answered_at > now() - make_interval(days => greatest(p_days, 1))
      and (v_admin or f.instructor_id = v_instr)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Instructor birthdays: tell members booked into their classes
-- ---------------------------------------------------------------------------
create or replace function public.queue_member_instructor_birthdays()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Europe/Dublin');
  v_local timestamp := now() at time zone v_tz;
  v_today date := v_local::date;
  v_n int;
  v_total int := 0;
begin
  if v_local::time < time '10:00' then return 0; end if;

  -- A week before: members booked into this instructor's classes between now and the birthday.
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select distinct on (b.user_id, i.id) b.user_id, 'instructor_birthday_member',
         jsonb_build_object('instructor_name', i.full_name, 'phase', 'week_before', 'birthday', v_today + 7,
                            'title', s.title, 'starts_at', s.starts_at),
         format('ibm:%s:%s:%s:week', i.id, b.user_id, v_today + 7)
  from public.instructors i
  join public.profiles ip on ip.id = i.profile_id and ip.date_of_birth is not null
  join public.class_sessions s on s.instructor_id = i.id and s.status = 'scheduled'
  join public.bookings b on b.session_id = s.id and b.status = 'booked'
  where i.is_active and public._birthday_on(ip.date_of_birth, v_today + 7)
    and public._local_date(s.starts_at) between v_today and v_today + 7
    and b.user_id <> ip.id
  order by b.user_id, i.id, s.starts_at
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- On the day: members booked into their class today.
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select distinct on (b.user_id, i.id) b.user_id, 'instructor_birthday_member',
         jsonb_build_object('instructor_name', i.full_name, 'phase', 'on_day', 'birthday', v_today,
                            'title', s.title, 'starts_at', s.starts_at),
         format('ibm:%s:%s:%s:day', i.id, b.user_id, v_today)
  from public.instructors i
  join public.profiles ip on ip.id = i.profile_id and ip.date_of_birth is not null
  join public.class_sessions s on s.instructor_id = i.id and s.status = 'scheduled'
  join public.bookings b on b.session_id = s.id and b.status = 'booked'
  where i.is_active and public._birthday_on(ip.date_of_birth, v_today)
    and public._local_date(s.starts_at) = v_today and s.starts_at > now()
    and b.user_id <> ip.id
  order by b.user_id, i.id, s.starts_at
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;
  return v_total;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-feedback-requests', '*/15 * * * *', $job$select public.queue_feedback_requests()$job$);
    perform cron.schedule('drop-member-instructor-birthdays', '*/15 * * * *', $job$select public.queue_member_instructor_birthdays()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._release_guest(), public._require_finance(), public.friend_offer_ok(uuid),
  public._admin_analytics(date, date), public._admin_ticket_sales(date, date), public._admin_can_refund(uuid),
  public._admin_cancel_checkout(uuid), public._admin_resolve_payment_review(uuid, text), public._admin_set_role(uuid, public.user_role),
  public._admin_dashboard(), public._admin_events(), public.queue_feedback_requests(), public.queue_member_instructor_birthdays()
  from public, anon, authenticated;
grant execute on function public.queue_feedback_requests(), public.queue_member_instructor_birthdays() to service_role;
revoke execute on function public.create_ticket_checkout(uuid, text, public.payment_provider, text), public.friend_offer(uuid),
  public.can_view_finance(), public.admin_analytics(date, date), public.admin_ticket_sales(date, date), public.admin_can_refund(uuid),
  public.admin_cancel_checkout(uuid), public.admin_resolve_payment_review(uuid, text), public.admin_set_role(uuid, public.user_role),
  public.admin_dashboard(), public.admin_events(), public.admin_set_access(uuid, text), public.submit_feedback(uuid, int, text, boolean),
  public.my_feedback_requests(), public.staff_feedback(int)
  from public, anon;
grant execute on function public.create_ticket_checkout(uuid, text, public.payment_provider, text), public.friend_offer(uuid),
  public.can_view_finance(), public.admin_analytics(date, date), public.admin_ticket_sales(date, date), public.admin_can_refund(uuid),
  public.admin_cancel_checkout(uuid), public.admin_resolve_payment_review(uuid, text), public.admin_set_role(uuid, public.user_role),
  public.admin_dashboard(), public.admin_events(), public.admin_set_access(uuid, text), public.submit_feedback(uuid, int, text, boolean),
  public.my_feedback_requests(), public.staff_feedback(int)
  to authenticated;

-- Ana Souto (anacarolina.soutoo@gmail.com): manager — runs the studio, no financial information.
update public.profiles set role = 'admin', finance_access = false where lower(email) = 'anacarolina.soutoo@gmail.com';
insert into public.audit_log (action, entity_type, entity_id, details)
select 'access_changed', 'profile', id::text, jsonb_build_object('level', 'manager', 'by', 'studio owner request')
from public.profiles where lower(email) = 'anacarolina.soutoo@gmail.com';
