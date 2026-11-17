-- Regular hires: other teachers' weekly classes (e.g. ballet, belly dance, kids) that close the studio for rental.
-- They show as "Booked" on the rental page, in blue on the admin calendar, and Drop classes can't go on them
-- (admins can override). Future months can be added "to be confirmed": the owner is asked before the deadline
-- and the times stay closed until the owner confirms or frees them.
create table if not exists public.rental_blocks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  confirm_by date,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (title, starts_at)
);
create index if not exists rental_blocks_during on public.rental_blocks using gist (during);
alter table public.rental_blocks enable row level security;
drop policy if exists rental_blocks_admin on public.rental_blocks;
create policy rental_blocks_admin on public.rental_blocks for select using (public.is_admin());

-- Adds a weekly regular hire between two dates (Dublin time). Admin only.
create or replace function public.admin_add_rental_blocks(p_title text, p_isodow int, p_start time, p_end time, p_from date, p_to date, p_confirm_by date default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public._require_admin();
  if p_end <= p_start or p_to < p_from or p_isodow not between 1 and 7 then perform public._fail('rental_invalid_time'); end if;
  insert into public.rental_blocks (title, starts_at, ends_at, confirm_by)
  select trim(p_title), (d::date + p_start)::timestamp at time zone 'Europe/Dublin', (d::date + p_end)::timestamp at time zone 'Europe/Dublin', p_confirm_by
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(isodow from d) = p_isodow and (d::date + p_start)::timestamp at time zone 'Europe/Dublin' > now()
  on conflict (title, starts_at) do nothing;
  get diagnostics n = row_count;
  perform public._audit('rental_blocks_added', 'rental_blocks', null, jsonb_build_object('title', p_title, 'isodow', p_isodow, 'start', p_start, 'end', p_end, 'from', p_from, 'to', p_to, 'count', n));
  return n;
end;
$$;

-- The owner keeps (confirms) or frees the regular hires waiting for confirmation. p_title null = all of them.
create or replace function public.admin_decide_rental_blocks(p_confirm_by date, p_keep boolean, p_title text default null)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public._require_admin();
  if p_keep then
    update public.rental_blocks set confirm_by = null, confirmed_at = now()
    where confirm_by = p_confirm_by and (p_title is null or title = p_title);
  else
    delete from public.rental_blocks where confirm_by = p_confirm_by and (p_title is null or title = p_title) and starts_at > now();
  end if;
  get diagnostics n = row_count;
  perform public._audit(case when p_keep then 'rental_blocks_confirmed' else 'rental_blocks_freed' end, 'rental_blocks', null, jsonb_build_object('confirm_by', p_confirm_by, 'title', p_title, 'count', n));
  return n;
end;
$$;

-- Frees one regular hire date (e.g. a teacher cancels a week). Admin only.
create or replace function public.admin_remove_rental_block(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  delete from public.rental_blocks where id = p_id;
  perform public._audit('rental_block_removed', 'rental_blocks', p_id::text, '{}'::jsonb);
end;
$$;
revoke all on function public.admin_add_rental_blocks(text, int, time, time, date, date, date), public.admin_decide_rental_blocks(date, boolean, text), public.admin_remove_rental_block(uuid) from public, anon;
grant execute on function public.admin_add_rental_blocks(text, int, time, time, date, date, date), public.admin_decide_rental_blocks(date, boolean, text), public.admin_remove_rental_block(uuid) to authenticated;

create or replace function public._rental_check(p_user uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
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
  if ls::date <> (le - interval '1 microsecond')::date
     or extract(hour from ls) * 60 + extract(minute from ls) < cfg.open_from_min
     or (le::date = ls::date and extract(hour from le) * 60 + extract(minute from le) > cfg.open_to_min) then
    reasons := array_append(reasons, 'outside_hours');
  end if;
  if p_start > now() + make_interval(weeks => cfg.max_weeks_ahead) then reasons := array_append(reasons, 'beyond_12_weeks'); end if;
  return reasons;
end;
$$;

create or replace function public.rental_busy(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]') from (
    select jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'what', 'Drop class') x
    from public.class_sessions s where s.status = 'scheduled' and s.starts_at < p_to and s.ends_at > p_from
    union all
    select jsonb_build_object('starts_at', st, 'ends_at', st + make_interval(mins => t.duration_minutes), 'what', 'Drop class')
    from public.class_templates t
    cross join generate_series((p_from at time zone 'Europe/Dublin')::date, (p_to at time zone 'Europe/Dublin')::date, interval '1 day') d
    cross join lateral (select ((d::date + t.start_time)::timestamp at time zone 'Europe/Dublin') st) x2
    where t.is_active and extract(isodow from d) = t.weekday and d::date >= t.valid_from and (t.valid_until is null or d::date <= t.valid_until)
      and st < p_to and st + make_interval(mins => t.duration_minutes) > p_from
      and not exists (select 1 from public.class_sessions s where s.template_id = t.id and s.starts_at = st)
    union all
    select jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'what', 'Booked')
    from public.rental_bookings b where b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed') and b.starts_at < p_to and b.ends_at > p_from
    union all
    select jsonb_build_object('starts_at', k.starts_at, 'ends_at', k.ends_at, 'what', 'Booked')
    from public.rental_blocks k where k.starts_at < p_to and k.ends_at > p_from
  ) q where p_to - p_from <= interval '62 days';
$$;

create or replace function public._rental_taken(p_from timestamptz, p_to timestamptz)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select coalesce(b.group_name, p.full_name, 'a renter') from public.rental_bookings b join public.profiles p on p.id = b.user_id
     where b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed') and b.during && tstzrange(p_from, p_to, '[)')
     order by b.starts_at limit 1),
    (select k.title from public.rental_blocks k where k.during && tstzrange(p_from, p_to, '[)') order by k.starts_at limit 1));
$$;

create or replace function public._calendar_events(p_from timestamptz, p_to timestamptz, p_type text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]') from (
    select jsonb_build_object('id', 'class-' || s.id, 'type', 'class', 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'title', coalesce((select e.title from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1), s.title),
      'detail', concat_ws(' · ', i.full_name, case when s.is_special then 'special event' end, s.booked_count || '/' || s.capacity || ' booked')) x
    from public.class_sessions s left join public.instructors i on i.id = s.instructor_id
    where p_type in ('all', 'classes') and s.status = 'scheduled' and s.starts_at < p_to and s.ends_at > p_from
    union all
    select jsonb_build_object('id', 'rental-' || b.id, 'type', 'rental', 'starts_at', b.starts_at, 'ends_at', b.ends_at,
      'title', 'Rental: ' || coalesce(b.group_name, p.full_name) || case when b.is_party then ' (party)' else '' end,
      'detail', concat_ws(' · ', p.full_name, p.phone, b.purpose, case when b.dj_minutes > 0 then 'DJ ' || (b.dj_minutes / 60.0) || 'h' end,
        case b.status when 'confirmed' then 'paid' else replace(b.status, '_', ' ') end))
    from public.rental_bookings b join public.profiles p on p.id = b.user_id
    where p_type in ('all', 'rentals') and b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed') and b.starts_at < p_to and b.ends_at > p_from
    union all
    select jsonb_build_object('id', 'block-' || k.id, 'type', 'rental', 'starts_at', k.starts_at, 'ends_at', k.ends_at,
      'title', 'Rental: ' || k.title,
      'detail', 'Regular hire' || case when k.confirm_by is not null then ' · to be confirmed by ' || to_char(k.confirm_by, 'FMDD Mon') else '' end)
    from public.rental_blocks k
    where p_type in ('all', 'rentals') and k.starts_at < p_to and k.ends_at > p_from
  ) q;
$$;

create or replace function public.rental_jobs()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  now_local timestamp := now() at time zone 'Europe/Dublin';
  today date := now_local::date;
  n_exp int; n_rel int; r record; bk public.rental_bookings;
begin
  -- Unpaid checkouts and approvals that ran out of time free the slot.
  update public.rental_bookings set status = 'expired' where status = 'awaiting_payment' and hold_expires_at < now();
  get diagnostics n_exp = row_count;
  -- Next month's slots not paid by the end of this month are released for others.
  for r in
    with rel as (update public.rental_bookings set status = 'released' where status = 'held' and hold_expires_at < now() returning *)
    select user_id, series_id, min(starts_at) first_at, count(*) n from rel group by user_id, series_id
  loop
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (r.user_id, 'rental_released', jsonb_build_object('first_at', r.first_at, 'count', r.n), 'rental_rel:' || r.series_id || ':' || today)
    on conflict (dedupe_key) do nothing;
  end loop;
  get diagnostics n_rel = row_count;

  -- Last week of the month: remind series renters to pay next month.
  if (today + 7) >= (date_trunc('month', today) + interval '1 month')::date then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select b.user_id, 'rental_next_month_due', jsonb_build_object('count', count(*), 'total_cents', sum(b.total_cents), 'first_at', min(b.starts_at),
        'deadline', max(b.hold_expires_at), 'group_name', max(b.group_name)), 'rental_due:' || b.series_id || ':' || max(b.month_key)
    from public.rental_bookings b where b.status = 'held' and b.payment_id is null
    group by b.user_id, b.series_id
    on conflict (dedupe_key) do nothing;
  end if;

  -- Reminders: the renter a day before; the owner a day before and 2 hours before.
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select b.user_id, 'rental_reminder', public._rental_payload(b) || jsonb_build_object('access_code', (select access_code from public.rental_private limit 1)), 'rental_rem24:' || b.id
  from public.rental_bookings b where b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + interval '24 hours'
  on conflict (dedupe_key) do nothing;
  for bk in select b.* from public.rental_bookings b where b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + interval '24 hours' loop
    perform public._rental_tell_owner('rental_owner_reminder', public._rental_payload(bk) || jsonb_build_object('when', 'tomorrow'), 'rental_own24:' || bk.id);
    if bk.starts_at <= now() + interval '2 hours' then
      perform public._rental_tell_owner('rental_owner_reminder', public._rental_payload(bk) || jsonb_build_object('when', 'in 2 hours'), 'rental_own2:' || bk.id);
    end if;
  end loop;

  -- Thamires' rental reports for the owner: daily at 21:00, weekly on Monday 08:00, monthly on the 1st at 08:00.
  if extract(hour from now_local) >= 21 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('daily'), 'rental_rep_d:' || today);
  end if;
  if extract(isodow from now_local) = 1 and extract(hour from now_local) >= 8 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('weekly'), 'rental_rep_w:' || today);
  end if;
  if extract(day from now_local) = 1 and extract(hour from now_local) >= 8 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('monthly'), 'rental_rep_m:' || today);
  end if;
  -- Regular hires waiting for confirmation: ask the owner 6 days and 2 days before the deadline, on the day,
  -- and once after it (the times stay closed until the owner frees them).
  for r in
    select k.confirm_by, case when today > k.confirm_by then 'late' when today = k.confirm_by then 'due' when today >= k.confirm_by - 2 then 'soon' else 'first' end stage,
      jsonb_agg(distinct jsonb_build_object('title', k.title, 'day', trim(to_char(k.starts_at at time zone 'Europe/Dublin', 'Day')),
        'from', to_char(k.starts_at at time zone 'Europe/Dublin', 'HH24:MI'), 'to', to_char(k.ends_at at time zone 'Europe/Dublin', 'HH24:MI'))) slots,
      min(k.starts_at) first_at, max(k.ends_at) last_at
    from public.rental_blocks k
    where k.confirm_by is not null and k.ends_at > now() and today >= k.confirm_by - 6 and today <= k.confirm_by + 1
    group by k.confirm_by, 2
  loop
    perform public._rental_tell_owner('rental_blocks_confirm', jsonb_build_object('confirm_by', r.confirm_by, 'slots', r.slots,
      'first_at', r.first_at, 'last_at', r.last_at, 'late', r.stage = 'late'), 'rental_blk:' || r.confirm_by || ':' || r.stage);
  end loop;
  return jsonb_build_object('expired', n_exp, 'released', n_rel);
end;
$$;
