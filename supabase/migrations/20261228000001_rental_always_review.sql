-- Renters whose every booking request needs the owner's approval (set per person by an admin).
create table if not exists public.rental_always_review (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.rental_always_review enable row level security;
revoke all on public.rental_always_review from anon, authenticated;
grant select on public.rental_always_review to authenticated;
drop policy if exists rental_always_review_admin on public.rental_always_review;
create policy rental_always_review_admin on public.rental_always_review for select to authenticated using (public.is_admin());

CREATE OR REPLACE FUNCTION public._rental_check(p_user uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_ignore uuid DEFAULT NULL::uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  ls timestamp := p_start at time zone 'Europe/Dublin';
  le timestamp := p_end at time zone 'Europe/Dublin';
  reasons text[] := '{}';
begin
  if p_end <= p_start then perform public._fail('rental_invalid_time'); end if;
  if p_start <= now() then perform public._fail('rental_in_past'); end if;
  if extract(minute from ls)::int % 30 <> 0 or extract(second from ls) <> 0 or (extract(epoch from p_end - p_start)::int % 1800) <> 0 then
    perform public._fail('rental_half_hours');
  end if;
  if p_end - p_start < interval '1 hour' then perform public._fail('rental_min_hour'); end if;
  if p_end - p_start > interval '16 hours' then perform public._fail('rental_too_long'); end if;
  -- Never at the same time as a Drop class.
  if exists (select 1 from public.class_sessions s where s.status = 'scheduled' and s.starts_at < p_end and s.ends_at > p_start) then
    perform public._fail('rental_class_clash');
  end if;
  -- Weekly classes that haven't been put on the timetable yet (it's created 5 weeks ahead).
  if exists (
    select 1 from public.class_templates t
    cross join generate_series(ls::date - 1, le::date, interval '1 day') d
    where t.is_active and extract(isodow from d) = t.weekday and d::date >= t.valid_from and (t.valid_until is null or d::date <= t.valid_until)
      and ((d::date + t.start_time)::timestamp at time zone 'Europe/Dublin') < p_end
      and ((d::date + t.start_time)::timestamp at time zone 'Europe/Dublin') + make_interval(mins => t.duration_minutes) > p_start
      and not exists (select 1 from public.class_sessions s where s.template_id = t.id
                      and s.starts_at = ((d::date + t.start_time)::timestamp at time zone 'Europe/Dublin'))) then
    perform public._fail('rental_class_clash');
  end if;
  if exists (select 1 from public.rental_bookings b where b.during && tstzrange(p_start, p_end, '[)') and b.id is distinct from p_ignore
             and b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed')) then
    perform public._fail('rental_unavailable');
  end if;
  -- Regular hires (other teachers' weekly classes) close the studio too.
  if exists (select 1 from public.rental_blocks k where k.during && tstzrange(p_start, p_end, '[)')) then
    perform public._fail('rental_unavailable');
  end if;
  if not exists (select 1 from public.rental_bookings where user_id = p_user and status = 'confirmed') then reasons := array_append(reasons, 'first_time'); end if;
  -- People the owner wants to approve every time.
  if exists (select 1 from public.rental_always_review where user_id = p_user) then reasons := array_append(reasons, 'always_review'); end if;
  if ls::date <> (le - interval '1 microsecond')::date
     or extract(hour from ls) * 60 + extract(minute from ls) < cfg.open_from_min
     or (le::date = ls::date and extract(hour from le) * 60 + extract(minute from le) > cfg.open_to_min) then
    reasons := array_append(reasons, 'outside_hours');
  end if;
  if p_start > now() + make_interval(weeks => cfg.max_weeks_ahead) then reasons := array_append(reasons, 'beyond_12_weeks'); end if;
  return reasons;
end;
$function$;
