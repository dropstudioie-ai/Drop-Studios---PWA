-- Scanning the check-in QR while logged out (e.g. the phone camera opens the browser, not the home-screen app):
-- the scan is turned into a 15-minute pass before the login, so after logging in they're checked in without scanning again.
create table if not exists public.checkin_passes (
  token uuid primary key default gen_random_uuid(),
  session_id uuid references public.class_sessions(id) on delete cascade,
  studio boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table public.checkin_passes enable row level security;
revoke all on public.checkin_passes from anon, authenticated;

/** Anyone holding a fresh QR code can turn it into a short pass (it only proves they saw the code). */
create or replace function public.checkin_pass(p_session_id uuid, p_code text, p_studio boolean default false)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  if p_studio then
    if not public._code_ok((select secret from public.studio_checkin_secret), p_code) then perform public._fail('checkin_code_expired'); end if;
  else
    if not public._code_ok((select secret from public.session_checkin_secrets where session_id = p_session_id), p_code) then perform public._fail('checkin_code_expired'); end if;
  end if;
  delete from public.checkin_passes where expires_at < now() - interval '1 day';
  insert into public.checkin_passes (session_id, studio) values (case when p_studio then null else p_session_id end, p_studio) returning token into v;
  return v;
end;
$$;

create or replace function public._pass_ok(p_code text, p_session_id uuid, p_studio boolean)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_code ~ '^[0-9a-f-]{36}$' and exists (
    select 1 from public.checkin_passes where token = p_code::uuid and expires_at > now()
      and studio = p_studio and (p_studio or session_id = p_session_id));
$$;

create or replace function public.check_in(p_session_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  if not (public._code_ok((select secret from public.session_checkin_secrets where session_id = s.id), p_code) or public._pass_ok(p_code, s.id, false)) then
    return public._checkin_failed(v_uid, s.id, 'checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then return public._checkin_failed(v_uid, s.id, 'checkin_closed'); end if;
  if not exists (select 1 from public.bookings where session_id = s.id and user_id = v_uid and status in ('booked', 'attended')) then
    return public._checkin_failed(v_uid, s.id, 'checkin_not_booked');
  end if;
  return public._mark_checked_in(v_uid, s);
end;
$function$;


create or replace function public.check_in_studio(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not (public._code_ok((select secret from public.studio_checkin_secret), p_code) or public._pass_ok(p_code, null, true)) then
    return public._checkin_failed(v_uid, null, 'checkin_code_expired');
  end if;
  select s2.* into s from public.class_sessions s2 join public.bookings b on b.session_id = s2.id
  where b.user_id = v_uid and b.status in ('booked', 'attended') and s2.status = 'scheduled'
    and now() between s2.starts_at - interval '1 hour' and s2.ends_at
  order by (b.status = 'attended'), s2.starts_at limit 1;
  if not found then return public._checkin_failed(v_uid, null, 'checkin_not_booked'); end if;
  return public._mark_checked_in(v_uid, s);
end;
$function$;


create or replace function public.book_and_check_in(p_session_id uuid, p_code text, p_studio boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  if not (public._pass_ok(p_code, case when p_studio then null else s.id end, p_studio) or public._code_ok(case when p_studio then (select secret from public.studio_checkin_secret)
                              else (select secret from public.session_checkin_secrets where session_id = s.id) end, p_code)) then
    perform public._fail('checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then perform public._fail('checkin_closed'); end if;
  perform public.book_class(s.id, null);   -- uses the right membership; fails with the reason if it can't
  return public._mark_checked_in(v_uid, s) || jsonb_build_object('booked_at_door', true);
end;
$function$;


revoke all on function public._pass_ok(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.checkin_pass(uuid, text, boolean) from public;
grant execute on function public.checkin_pass(uuid, text, boolean) to anon, authenticated;
