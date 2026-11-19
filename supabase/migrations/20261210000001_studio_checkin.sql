-- One reception QR for every class: an admin shows it (new code every 30 seconds) and whoever scans it is
-- checked in to the class they're booked into that is on now (from 1 hour before until it ends).

create table if not exists public.studio_checkin_secret (
  id boolean primary key default true check (id),
  secret text not null default replace(gen_random_uuid()::text, '-', '')
);
alter table public.studio_checkin_secret enable row level security;   -- functions only
revoke all on public.studio_checkin_secret from anon, authenticated;
insert into public.studio_checkin_secret default values on conflict do nothing;

-- Marks the member's booking attended and says whether it's their first class or birthday.
create or replace function public._mark_checked_in(p_uid uuid, s public.class_sessions)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings;
  p public.profiles;
  v_first boolean;
  v_birthday boolean;
begin
  select * into b from public.bookings where session_id = s.id and user_id = p_uid and status in ('booked', 'attended') for update;
  if not found then perform public._fail('checkin_not_booked'); end if;
  select * into p from public.profiles where id = p_uid;
  v_first := not exists (select 1 from public.bookings x where x.user_id = p_uid and x.status = 'attended' and x.id <> b.id);
  v_birthday := p.date_of_birth is not null and to_char(p.date_of_birth, 'MM-DD') = to_char(now() at time zone 'Europe/Dublin', 'MM-DD');
  if b.status = 'booked' then
    update public.bookings set status = 'attended', attendance_marked_at = now(), attendance_marked_by = p_uid where id = b.id;
  end if;
  return jsonb_build_object('ok', true, 'already', b.status = 'attended', 'title', s.title, 'starts_at', s.starts_at,
    'first_name', split_part(coalesce(p.full_name, ''), ' ', 1), 'first_class', v_first, 'birthday', v_birthday,
    'turning', case when v_birthday then extract(year from now() at time zone 'Europe/Dublin')::int - extract(year from p.date_of_birth)::int end);
end;
$$;

create or replace function public.check_in(p_session_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.class_sessions;
  v_secret text;
  w bigint := floor(extract(epoch from now())) / 30;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found or s.status <> 'scheduled' then perform public._fail('session_not_found'); end if;
  select secret into v_secret from public.session_checkin_secrets where session_id = s.id;
  if v_secret is null or coalesce(p_code, '') not in (public._checkin_code(v_secret, w), public._checkin_code(v_secret, w - 1),
       public._checkin_code(v_secret, w - 2), public._checkin_code(v_secret, w - 3)) then
    perform public._fail('checkin_code_expired');
  end if;
  if now() < s.starts_at - interval '1 hour' or now() > s.ends_at then perform public._fail('checkin_closed'); end if;
  return public._mark_checked_in(auth.uid(), s);
end;
$$;

create or replace function public.studio_checkin_code()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_epoch bigint := floor(extract(epoch from now()));
begin
  perform public._require_admin();
  return jsonb_build_object('code', public._checkin_code((select secret from public.studio_checkin_secret), v_epoch / 30), 'valid_for', 30 - (v_epoch % 30));
end;
$$;

-- Scanning the reception code: checks in to the member's booked class that's on now (the soonest one).
create or replace function public.check_in_studio(p_code text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_secret text := (select secret from public.studio_checkin_secret);
  w bigint := floor(extract(epoch from now())) / 30;
  s public.class_sessions;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if coalesce(p_code, '') not in (public._checkin_code(v_secret, w), public._checkin_code(v_secret, w - 1),
       public._checkin_code(v_secret, w - 2), public._checkin_code(v_secret, w - 3)) then
    perform public._fail('checkin_code_expired');
  end if;
  select s2.* into s from public.class_sessions s2 join public.bookings b on b.session_id = s2.id
  where b.user_id = auth.uid() and b.status in ('booked', 'attended') and s2.status = 'scheduled'
    and now() between s2.starts_at - interval '1 hour' and s2.ends_at
  order by (b.status = 'attended'), s2.starts_at limit 1;
  if not found then perform public._fail('checkin_not_booked'); end if;
  return public._mark_checked_in(auth.uid(), s);
end;
$$;

-- Admin's reception screen: who has checked in to the classes on now.
create or replace function public.admin_checkins_now()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'full_name', p.full_name, 'title', s.title,
      'at', b.attendance_marked_at,
      'is_new', not exists (select 1 from public.bookings x where x.user_id = b.user_id and x.status = 'attended' and x.id <> b.id),
      'is_birthday', p.date_of_birth is not null and to_char(p.date_of_birth, 'MM-DD') = to_char(now() at time zone 'Europe/Dublin', 'MM-DD'))
      order by b.attendance_marked_at), '[]')
    from public.bookings b join public.class_sessions s on s.id = b.session_id join public.profiles p on p.id = b.user_id
    where b.status = 'attended' and s.status = 'scheduled' and now() between s.starts_at - interval '1 hour' and s.ends_at);
end;
$$;

revoke all on function public._mark_checked_in(uuid, public.class_sessions) from public, anon, authenticated;
revoke all on function public.studio_checkin_code(), public.check_in_studio(text), public.admin_checkins_now() from public, anon;
grant execute on function public.studio_checkin_code(), public.check_in_studio(text), public.admin_checkins_now() to authenticated;
