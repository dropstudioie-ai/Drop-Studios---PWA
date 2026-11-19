-- Self check-in: the teacher shows a QR code on their phone (it changes every 30 seconds); members scan it
-- and are marked attended. They see a welcome on their first class and a birthday surprise on their
-- birthday; the teacher's list shows who has arrived. Instructors are reminded 5 and 15 minutes after
-- class if anyone booked hasn't been marked.

create table if not exists public.session_checkin_secrets (
  session_id uuid primary key references public.class_sessions(id) on delete cascade,
  secret text not null default replace(gen_random_uuid()::text, '-', '')
);
alter table public.session_checkin_secrets enable row level security;   -- no policies: functions only
revoke all on public.session_checkin_secrets from anon, authenticated;

create or replace function public._checkin_code(p_secret text, p_window bigint)
returns text language sql immutable set search_path = public, pg_temp as $$
  select substr(md5(p_secret || ':' || p_window::text), 1, 10);
$$;

create or replace function public._can_run_session(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or exists (select 1 from public.class_sessions s join public.instructors i on i.id = s.instructor_id
    where s.id = p_session_id and i.profile_id = auth.uid());
$$;

-- The teacher's current code (refresh every ~25 seconds).
create or replace function public.checkin_code(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_secret text;
  v_epoch bigint := floor(extract(epoch from now()));
begin
  if not public._can_run_session(p_session_id) then perform public._fail('forbidden'); end if;
  insert into public.session_checkin_secrets (session_id) values (p_session_id) on conflict (session_id) do nothing;
  select secret into v_secret from public.session_checkin_secrets where session_id = p_session_id;
  return jsonb_build_object('code', public._checkin_code(v_secret, v_epoch / 30), 'valid_for', 30 - (v_epoch % 30));
end;
$$;

-- The member scans: marks their booking attended (from 1 hour before class until it ends).
create or replace function public.check_in(p_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
  v_secret text;
  w bigint := floor(extract(epoch from now())) / 30;
  b public.bookings;
  p public.profiles;
  v_first boolean;
  v_birthday boolean;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  select secret into v_secret from public.session_checkin_secrets where session_id = s.id;
  -- The code on screen now or in the last 2 minutes (time to scan, and to log in if needed).
  if v_secret is null or coalesce(p_code, '') not in (public._checkin_code(v_secret, w), public._checkin_code(v_secret, w - 1),
       public._checkin_code(v_secret, w - 2), public._checkin_code(v_secret, w - 3)) then
    perform public._fail('checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then perform public._fail('checkin_closed'); end if;
  select * into b from public.bookings where session_id = s.id and user_id = v_uid and status in ('booked', 'attended') for update;
  if not found then perform public._fail('checkin_not_booked'); end if;
  select * into p from public.profiles where id = v_uid;
  v_first := not exists (select 1 from public.bookings x where x.user_id = v_uid and x.status = 'attended' and x.id <> b.id);
  v_birthday := p.date_of_birth is not null and to_char(p.date_of_birth, 'MM-DD') = to_char(now() at time zone 'Europe/Dublin', 'MM-DD');
  if b.status = 'booked' then
    update public.bookings set status = 'attended', attendance_marked_at = now(), attendance_marked_by = v_uid where id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'already', b.status = 'attended', 'title', s.title, 'starts_at', s.starts_at,
    'first_name', split_part(coalesce(p.full_name, ''), ' ', 1), 'first_class', v_first, 'birthday', v_birthday,
    'turning', case when v_birthday then extract(year from now() at time zone 'Europe/Dublin')::int - extract(year from p.date_of_birth)::int end);
end;
$$;

-- Reminders to the instructor 5 and 15 minutes after class while someone booked is still unmarked (pg_cron, every 5 minutes).
create or replace function public.attendance_reminders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; r record;
begin
  for r in
    select s.id, s.title, s.ends_at, i.profile_id,
      case when now() >= s.ends_at + interval '15 minutes' then '15' else '5' end as stage,
      (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'booked') as unmarked
    from public.class_sessions s join public.instructors i on i.id = s.instructor_id
    where s.status = 'scheduled' and i.profile_id is not null
      and now() >= s.ends_at + interval '5 minutes' and now() < s.ends_at + interval '45 minutes'
  loop
    continue when r.unmarked = 0;
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (r.profile_id, 'attendance_reminder', jsonb_build_object('session_id', r.id, 'title', r.title, 'unmarked', r.unmarked, 'stage', r.stage),
      'att_rem:' || r.id || ':' || r.stage)
    on conflict (dedupe_key) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end;
$$;

revoke all on function public._checkin_code(text, bigint), public._can_run_session(uuid), public.attendance_reminders() from public, anon, authenticated;
revoke all on function public.checkin_code(uuid), public.check_in(uuid, text) from public, anon;
grant execute on function public.checkin_code(uuid), public.check_in(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('drop-attendance-reminders') from cron.job where jobname = 'drop-attendance-reminders'$q$;
    execute $q$select cron.schedule('drop-attendance-reminders', '*/5 * * * *', 'select public.attendance_reminders()')$q$;
  end if;
end $$;
