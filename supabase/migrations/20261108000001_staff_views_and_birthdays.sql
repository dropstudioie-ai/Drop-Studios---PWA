-- Drop Studios — staff (instructor) views, hidden class numbers, birthdays.
--
-- * Members never see how many people are booked: booked_count and capacity
--   are no longer readable by the public. The timetable comes from
--   timetable(), which only says available / almost_full (≤10 left) / full.
-- * Instructors see and manage only the classes they teach (instructors
--   .profile_id links a teacher to a login). Admins see everything.
-- * Members give a date of birth at sign-up; teachers are alerted the day
--   before and 10 minutes before a class that a birthday member is booked into.

-- ---------------------------------------------------------------------------
-- Date of birth
-- ---------------------------------------------------------------------------
alter table public.profiles add column date_of_birth date;
grant update (date_of_birth) on public.profiles to authenticated;

create or replace function public.guard_profile_dob()
returns trigger
language plpgsql
as $$
begin
  if new.date_of_birth is not null and (new.date_of_birth > current_date or new.date_of_birth < date '1900-01-01') then
    raise exception 'invalid_date_of_birth';
  end if;
  return new;
end;
$$;
create trigger profiles_dob_guard before insert or update of date_of_birth on public.profiles
  for each row execute function public.guard_profile_dob();

create or replace function public._safe_date(p text)
returns date
language plpgsql
immutable
as $$
begin
  return nullif(btrim(p), '')::date;
exception when others then
  return null;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dob date := public._safe_date(new.raw_user_meta_data ->> 'date_of_birth');
begin
  if v_dob is not null and (v_dob > current_date or v_dob < date '1900-01-01') then
    v_dob := null;
  end if;
  insert into public.profiles (id, full_name, email, phone, date_of_birth)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    v_dob
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hide class numbers from the public
-- ---------------------------------------------------------------------------
revoke select on public.class_sessions from anon, authenticated;
grant select (id, template_id, title, style_id, instructor_id, starts_at, ends_at, level, room,
  is_special, ticket_price_cents, status, cancel_reason, created_at)
  on public.class_sessions to anon, authenticated;

create or replace function public._availability(p_capacity int, p_booked int)
returns text
language sql
immutable
as $$
  select case
    when p_booked >= p_capacity then 'full'
    when p_capacity - p_booked <= 10 then 'almost_full'
    else 'available'
  end;
$$;

-- Public timetable (GET-able, so the app can cache it for offline use).
create or replace function public.timetable(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_session_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'template_id', s.template_id, 'title', s.title,
      'style_id', s.style_id, 'instructor_id', s.instructor_id,
      'starts_at', s.starts_at, 'ends_at', s.ends_at, 'level', s.level, 'room', s.room,
      'is_special', s.is_special, 'ticket_price_cents', s.ticket_price_cents,
      'status', s.status, 'cancel_reason', s.cancel_reason,
      'availability', public._availability(s.capacity, s.booked_count),
      'style', (select jsonb_build_object('id', d.id, 'name', d.name, 'color', d.color, 'slug', d.slug)
                from public.dance_styles d where d.id = s.style_id),
      'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name)
                     from public.instructors i where i.id = s.instructor_id)
    ) order by s.starts_at), '[]'::jsonb)
  from public.class_sessions s
  where (p_session_id is not null and s.id = p_session_id)
     or (p_session_id is null and s.starts_at >= p_from and s.starts_at < p_to
         and p_to - p_from <= interval '62 days');
$$;

-- ---------------------------------------------------------------------------
-- Instructor scope
-- ---------------------------------------------------------------------------
create or replace function public.teaches_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.class_sessions s
    join public.instructors i on i.id = s.instructor_id
    where s.id = p_session_id and i.profile_id = auth.uid() and i.is_active
  );
$$;

create or replace function public.can_staff_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_admin() or public.teaches_session(p_session_id);
$$;

-- Instructors only see bookings for classes they teach (was: every booking).
drop policy bookings_own on public.bookings;
create policy bookings_own on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.teaches_session(session_id));

create or replace function public._is_new_member(p_user uuid, p_before timestamptz)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select not exists (
    select 1 from public.bookings b join public.class_sessions s on s.id = b.session_id
    where b.user_id = p_user and b.status in ('booked', 'attended', 'no_show') and s.starts_at < p_before
  );
$$;

-- Birthday on a given day (29 Feb birthdays are celebrated on 28 Feb in other years).
create or replace function public._birthday_on(p_dob date, p_day date)
returns boolean
language sql
immutable
as $$
  select p_dob is not null and (
    to_char(p_dob, 'MM-DD') = to_char(p_day, 'MM-DD')
    or (to_char(p_dob, 'MM-DD') = '02-29' and to_char(p_day, 'MM-DD') = '02-28'
        and not ((extract(year from p_day)::int % 4 = 0 and extract(year from p_day)::int % 100 <> 0)
                 or extract(year from p_day)::int % 400 = 0))
  );
$$;

create or replace function public.staff_sessions(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin boolean := public.is_admin();
begin
  if auth.uid() is null or not (v_admin or public.is_staff()) then perform public._fail('forbidden'); end if;
  if p_to - p_from > interval '62 days' then perform public._fail('invalid_date_range'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'template_id', s.template_id, 'title', s.title, 'style_id', s.style_id,
        'instructor_id', s.instructor_id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'level', s.level, 'room', s.room, 'is_special', s.is_special,
        'ticket_price_cents', s.ticket_price_cents, 'status', s.status, 'cancel_reason', s.cancel_reason,
        'capacity', s.capacity, 'booked_count', s.booked_count,
        'availability', public._availability(s.capacity, s.booked_count),
        'birthdays', (select count(*) from public.bookings b join public.profiles p on p.id = b.user_id
                      where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show')
                        and public._birthday_on(p.date_of_birth, public._local_date(s.starts_at))),
        'new_members', (select count(*) from public.bookings b
                        where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show')
                          and public._is_new_member(b.user_id, s.starts_at)),
        'style', (select jsonb_build_object('id', d.id, 'name', d.name, 'color', d.color, 'slug', d.slug)
                  from public.dance_styles d where d.id = s.style_id),
        'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name)
                       from public.instructors i where i.id = s.instructor_id)
      ) order by s.starts_at), '[]'::jsonb)
    from public.class_sessions s
    where s.starts_at >= p_from and s.starts_at < p_to
      and (v_admin or public.teaches_session(s.id))
  );
end;
$$;

-- Class list for the teacher: who is booked, with photo, New and birthday flags.
create or replace function public.staff_roster(p_session_id uuid)
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

-- Find a member to add to a class (staff only; small result set).
create or replace function public.staff_find_members(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  q text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null or not public.is_staff() then perform public._fail('forbidden'); end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  q := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return (
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'email', p.email, 'avatar_path', p.avatar_path)
                              order by p.full_name), '[]'::jsonb)
    from (
      select * from public.profiles
      where full_name ilike q or email ilike q
      order by full_name limit 12
    ) p
  );
end;
$$;

create or replace function public._book_for(
  p_user uuid,
  p_session_id uuid,
  p_membership_id uuid,
  p_actor uuid,
  p_by_staff boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := p_user;
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

  if p_by_staff then
    -- Staff add members at the door: no booking window, open until the class ends.
    if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;
    if s.ends_at <= now() then perform public._fail('session_started'); end if;
    if exists (
      select 1 from public.bookings where user_id = v_uid and session_id = s.id
        and status in ('booked', 'attended', 'no_show', 'pending_payment')
    ) then perform public._fail('already_booked'); end if;
    if s.booked_count >= s.capacity then perform public._fail('session_full'); end if;
  else
    v_issue := public._session_issue(s, v_uid);
    if v_issue is not null then perform public._fail(v_issue); end if;
  end if;

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
  values (m.id, v_uid, -1, v_remaining, 'booking', v_booking_id, p_actor);

  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'membership_id', m.id,
    'classes_remaining', v_remaining
  );
end;
$$;

create or replace function public.book_class(p_session_id uuid, p_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(auth.uid()) then perform public._fail('profile_photo_required'); end if;
  return public._book_for(auth.uid(), p_session_id, p_membership_id, auth.uid(), false);
end;
$$;

-- Teacher (or admin) books a member into a class, using the member's membership.
create or replace function public.staff_book_member(p_session_id uuid, p_user_id uuid, p_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null or not public.can_staff_session(p_session_id) then perform public._fail('forbidden'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then perform public._fail('user_not_found'); end if;
  v_result := public._book_for(p_user_id, p_session_id, p_membership_id, auth.uid(), true);
  perform public._audit('staff_booked_member', 'booking', v_result ->> 'booking_id',
    jsonb_build_object('user_id', p_user_id, 'session_id', p_session_id));
  return v_result;
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
  if p_status not in ('attended', 'no_show', 'booked') then perform public._fail('invalid_status'); end if;

  select * into b from public.bookings where id = p_booking_id;
  if not found then perform public._fail('booking_not_found'); end if;
  if not public.can_staff_session(b.session_id) then perform public._fail('forbidden'); end if;
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
      'ticket_price_cents', case when s.is_special then s.ticket_price_cents end,
      'drop_in_price_cents', case when not s.is_special then (select drop_in_price_cents from public.dance_styles where id = s.style_id) end);
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
          'availability', public._availability(alt.capacity, alt.booked_count)
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
    'drop_in_price_cents', case when not s.is_special then (select drop_in_price_cents from public.dance_styles where id = s.style_id) end,
    'has_profile_photo', public.has_profile_photo(v_uid),
    'eligible_membership_id', v_eligible,
    'memberships', v_options,
    'alternatives', v_alts,
    'cancellation_cutoff_minutes', cfg.cancellation_cutoff_minutes,
    'late_cancel_restores_class', cfg.late_cancel_restores_class
  );
end;
$$;

-- Link an instructor to a login (by email), making that person an instructor.
create or replace function public.admin_link_instructor(p_instructor_id uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.profiles;
begin
  perform public._require_admin();
  if not exists (select 1 from public.instructors where id = p_instructor_id) then perform public._fail('instructor_not_found'); end if;
  if coalesce(btrim(p_email), '') = '' then
    update public.instructors set profile_id = null where id = p_instructor_id;
    perform public._audit('instructor_unlinked', 'instructor', p_instructor_id::text, '{}');
    return jsonb_build_object('linked', false);
  end if;
  select * into p from public.profiles where lower(email) = lower(btrim(p_email));
  if not found then perform public._fail('user_not_found'); end if;
  update public.instructors set profile_id = null where profile_id = p.id and id <> p_instructor_id;
  update public.instructors set profile_id = p.id where id = p_instructor_id;
  if p.role = 'customer' then update public.profiles set role = 'instructor' where id = p.id; end if;
  perform public._audit('instructor_linked', 'instructor', p_instructor_id::text, jsonb_build_object('user_id', p.id, 'email', p.email));
  return jsonb_build_object('linked', true, 'user_id', p.id, 'full_name', p.full_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Birthday alerts for teachers
-- ---------------------------------------------------------------------------
alter table public.notification_outbox add column dedupe_key text unique;

-- Queues, once per phase, a note to the teacher when a member who has a
-- birthday on the day of the class is booked in: "day_before" (sent as soon as
-- the class is less than 24 h away) and "ten_min" (in the last 10 minutes).
create or replace function public.queue_birthday_alerts()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select i.profile_id, 'member_birthday',
         jsonb_build_object(
           'member_name', p.full_name, 'title', s.title, 'starts_at', s.starts_at,
           'phase', case when s.starts_at <= now() + interval '10 minutes' then 'ten_min' else 'day_before' end,
           'turning', date_part('year', age(public._local_date(s.starts_at), p.date_of_birth))::int,
           'session_id', s.id),
         format('bday:%s:%s:%s', s.id, p.id,
                case when s.starts_at <= now() + interval '10 minutes' then 'ten_min' else 'day_before' end)
  from public.class_sessions s
  join public.instructors i on i.id = s.instructor_id and i.profile_id is not null and i.is_active
  join public.bookings b on b.session_id = s.id and b.status = 'booked'
  join public.profiles p on p.id = b.user_id
  where s.status = 'scheduled'
    and s.starts_at > now() and s.starts_at <= now() + interval '24 hours'
    and public._birthday_on(p.date_of_birth, public._local_date(s.starts_at))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-birthday-alerts', '*/5 * * * *', $job$select public.queue_birthday_alerts()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._safe_date(text), public._availability(int, int), public.timetable(timestamptz, timestamptz, uuid),
  public.teaches_session(uuid), public.can_staff_session(uuid), public._is_new_member(uuid, timestamptz),
  public._birthday_on(date, date), public.staff_sessions(timestamptz, timestamptz), public.staff_roster(uuid),
  public.staff_find_members(text), public._book_for(uuid, uuid, uuid, uuid, boolean),
  public.staff_book_member(uuid, uuid, uuid), public.admin_link_instructor(uuid, text), public.queue_birthday_alerts()
  from public, anon, authenticated;

grant execute on function public.timetable(timestamptz, timestamptz, uuid) to anon, authenticated;
-- Used inside RLS policies, so callers need execute.
grant execute on function public.teaches_session(uuid) to authenticated;
grant execute on function public.staff_sessions(timestamptz, timestamptz), public.staff_roster(uuid),
  public.staff_find_members(text), public.staff_book_member(uuid, uuid, uuid),
  public.admin_link_instructor(uuid, text) to authenticated;
grant execute on function public.queue_birthday_alerts() to service_role;
