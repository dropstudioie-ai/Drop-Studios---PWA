-- Check-in, part 3:
--  * A member who scans but isn't booked can "Book & check in" straight away (a class from their
--    membership), or pay for a Drop In, when the class has space.
--  * Every scan that doesn't go through is recorded, and the teacher's (or reception's) QR screen shows it
--    with the member's name and the reason, until that person is checked in.

create table if not exists public.checkin_attempts (
  id bigserial primary key,
  session_id uuid references public.class_sessions(id) on delete cascade,   -- null: reception code, no class matched
  user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists checkin_attempts_recent on public.checkin_attempts (created_at desc);
alter table public.checkin_attempts enable row level security;   -- functions only
revoke all on public.checkin_attempts from anon, authenticated;

create or replace function public._code_ok(p_secret text, p_code text)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select p_secret is not null and coalesce(p_code, '') in (
    public._checkin_code(p_secret, floor(extract(epoch from now()))::bigint / 30),
    public._checkin_code(p_secret, floor(extract(epoch from now()))::bigint / 30 - 1),
    public._checkin_code(p_secret, floor(extract(epoch from now()))::bigint / 30 - 2),
    public._checkin_code(p_secret, floor(extract(epoch from now()))::bigint / 30 - 3));
$$;

-- Classes on now (1 hour before until the end) the member could book at the door.
create or replace function public._door_options(p_uid uuid, p_session_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('session_id', s.id, 'title', s.title, 'starts_at', s.starts_at,
      'spots_left', s.capacity - s.booked_count, 'is_special', s.is_special,
      'membership', (select m.plan_name from public.memberships m where m.id = (public.booking_options(s.id) ->> 'eligible_membership_id')::uuid),
      'drop_in_price_cents', (public.booking_options(s.id) ->> 'drop_in_price_cents')::int) order by s.starts_at), '[]')
  from public.class_sessions s
  where s.status = 'scheduled' and now() between s.starts_at - interval '1 hour' and s.ends_at
    and (p_session_id is null or s.id = p_session_id)
    and not exists (select 1 from public.bookings b where b.session_id = s.id and b.user_id = p_uid and b.status in ('booked', 'attended', 'pending_payment'));
$$;

create or replace function public._checkin_failed(p_uid uuid, p_session_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.checkin_attempts (session_id, user_id, reason) values (p_session_id, p_uid, p_reason);
  return jsonb_build_object('ok', false, 'reason', p_reason,
    'options', case when p_reason = 'checkin_not_booked' then public._door_options(p_uid, p_session_id) else '[]'::jsonb end);
end;
$$;

-- Scanning the teacher's code. Failures are returned (and recorded), not raised.
create or replace function public.check_in(p_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  if not public._code_ok((select secret from public.session_checkin_secrets where session_id = s.id), p_code) then
    return public._checkin_failed(v_uid, s.id, 'checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then return public._checkin_failed(v_uid, s.id, 'checkin_closed'); end if;
  if not exists (select 1 from public.bookings where session_id = s.id and user_id = v_uid and status in ('booked', 'attended')) then
    return public._checkin_failed(v_uid, s.id, 'checkin_not_booked');
  end if;
  return public._mark_checked_in(v_uid, s);
end;
$$;

-- Scanning the reception code.
create or replace function public.check_in_studio(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public._code_ok((select secret from public.studio_checkin_secret), p_code) then
    return public._checkin_failed(v_uid, null, 'checkin_code_expired');
  end if;
  select s2.* into s from public.class_sessions s2 join public.bookings b on b.session_id = s2.id
  where b.user_id = v_uid and b.status in ('booked', 'attended') and s2.status = 'scheduled'
    and now() between s2.starts_at - interval '1 hour' and s2.ends_at
  order by (b.status = 'attended'), s2.starts_at limit 1;
  if not found then return public._checkin_failed(v_uid, null, 'checkin_not_booked'); end if;
  return public._mark_checked_in(v_uid, s);
end;
$$;

-- "Book & check in": books with the member's membership and checks them in, in one go.
create or replace function public.book_and_check_in(p_session_id uuid, p_code text, p_studio boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  if not public._code_ok(case when p_studio then (select secret from public.studio_checkin_secret)
                              else (select secret from public.session_checkin_secrets where session_id = s.id) end, p_code) then
    perform public._fail('checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then perform public._fail('checkin_closed'); end if;
  perform public.book_class(s.id, null);   -- uses the right membership; fails with the reason if it can't
  return public._mark_checked_in(v_uid, s) || jsonb_build_object('booked_at_door', true);
end;
$$;

-- Scans that didn't go through (in the last 2 hours), for people not checked in since.
create or replace function public._open_alerts(p_session_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]') from (
    select distinct on (a.user_id) jsonb_build_object('id', a.id, 'full_name', p.full_name, 'reason', a.reason, 'at', a.created_at,
      'title', (select title from public.class_sessions where id = a.session_id)) x
    from public.checkin_attempts a join public.profiles p on p.id = a.user_id
    where a.created_at > now() - interval '2 hours'
      and (p_session_id is null or a.session_id = p_session_id)
      and not exists (select 1 from public.bookings b join public.class_sessions s on s.id = b.session_id
        where b.user_id = a.user_id and b.status = 'attended' and b.attendance_marked_at > a.created_at
          and (p_session_id is null or s.id = p_session_id))
    order by a.user_id, a.created_at desc
  ) q;
$$;

create or replace function public.checkin_alerts(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public._can_run_session(p_session_id) then perform public._fail('forbidden'); end if;
  return public._open_alerts(p_session_id);
end;
$$;

create or replace function public.admin_checkin_alerts()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return public._open_alerts(null);
end;
$$;

revoke all on function public._code_ok(text, text), public._door_options(uuid, uuid), public._checkin_failed(uuid, uuid, text), public._open_alerts(uuid) from public, anon, authenticated;
revoke all on function public.book_and_check_in(uuid, text, boolean), public.checkin_alerts(uuid), public.admin_checkin_alerts() from public, anon;
grant execute on function public.book_and_check_in(uuid, text, boolean), public.checkin_alerts(uuid), public.admin_checkin_alerts() to authenticated;
