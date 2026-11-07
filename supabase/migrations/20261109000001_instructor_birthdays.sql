-- Drop Studios — instructor birthdays.
--
-- * Instructors must add their date of birth before they can use the teacher
--   view (staff_sessions / staff_roster / staff_book_member raise
--   'dob_required'). It stays private on their profile (never on the public
--   instructors table).
-- * Admins are told about each instructor's birthday a week in advance and on
--   the day (from 09:00 Dublin time), once per admin, birthday and phase.

-- ---------------------------------------------------------------------------
-- Date of birth required for instructors
-- ---------------------------------------------------------------------------
create or replace function public._require_staff_dob()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and exists (
    select 1 from public.profiles where id = auth.uid() and role = 'instructor' and date_of_birth is null
  ) then
    perform public._fail('dob_required');
  end if;
end;
$$;

alter function public.staff_sessions(timestamptz, timestamptz) rename to _staff_sessions;
alter function public.staff_roster(uuid) rename to _staff_roster;
alter function public.staff_book_member(uuid, uuid, uuid) rename to _staff_book_member;
revoke execute on function public._staff_sessions(timestamptz, timestamptz), public._staff_roster(uuid),
  public._staff_book_member(uuid, uuid, uuid) from public, anon, authenticated;

create function public.staff_sessions(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_staff_dob();
  return public._staff_sessions(p_from, p_to);
end;
$$;

create function public.staff_roster(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_staff_dob();
  return public._staff_roster(p_session_id);
end;
$$;

create function public.staff_book_member(p_session_id uuid, p_user_id uuid, p_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_staff_dob();
  return public._staff_book_member(p_session_id, p_user_id, p_membership_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: instructors' birthdays (private, so not on the public instructors table)
-- ---------------------------------------------------------------------------
create or replace function public.admin_instructor_birthdays()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := public._local_date(now());
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'instructor_id', i.id,
      'login_email', p.email,
      'date_of_birth', p.date_of_birth,
      'next_birthday', (select d from generate_series(v_today, v_today + 366, interval '1 day') g(d)
                        where public._birthday_on(p.date_of_birth, d::date) limit 1)::date))
    from public.instructors i
    left join public.profiles p on p.id = i.profile_id
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin notifications: instructor birthdays (a week before and on the day)
-- ---------------------------------------------------------------------------
create or replace function public.queue_instructor_birthday_alerts()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Europe/Dublin');
  v_local timestamp := now() at time zone v_tz;
  v_today date := v_local::date;
  v_count int;
begin
  -- Nobody wants a birthday message at midnight.
  if v_local::time < time '09:00' then return 0; end if;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select a.id, 'instructor_birthday',
         jsonb_build_object(
           'instructor_name', i.full_name,
           'phase', ph.phase,
           'birthday', ph.day,
           'turning', date_part('year', age(ph.day, p.date_of_birth))::int),
         format('ibday:%s:%s:%s:%s', i.id, a.id, ph.day, ph.phase)
  from public.instructors i
  join public.profiles p on p.id = i.profile_id and p.date_of_birth is not null
  cross join lateral (values ('week_before', v_today + 7), ('on_day', v_today)) ph(phase, day)
  join public.profiles a on a.role = 'admin' and a.id <> p.id
  where i.is_active
    and public._birthday_on(p.date_of_birth, ph.day)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-instructor-birthdays', '*/15 * * * *', $job$select public.queue_instructor_birthday_alerts()$job$);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._require_staff_dob(), public.staff_sessions(timestamptz, timestamptz),
  public.staff_roster(uuid), public.staff_book_member(uuid, uuid, uuid),
  public.admin_instructor_birthdays(), public.queue_instructor_birthday_alerts()
  from public, anon, authenticated;
grant execute on function public.staff_sessions(timestamptz, timestamptz), public.staff_roster(uuid),
  public.staff_book_member(uuid, uuid, uuid), public.admin_instructor_birthdays() to authenticated;
grant execute on function public.queue_instructor_birthday_alerts() to service_role;
