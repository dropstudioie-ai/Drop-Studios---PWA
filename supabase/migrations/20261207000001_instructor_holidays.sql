-- Instructors request holidays from their profile; admins approve or decline. For approved holidays,
-- admins choose a cover instructor or cancel each class (members are told either way). Classes that the
-- weekly timetable adds later inside an approved holiday show up in the same list automatically.

create table if not exists public.instructor_time_off (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references public.instructors(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  note text check (length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'cancelled')),
  admin_note text check (length(admin_note) <= 500),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists instructor_time_off_dates on public.instructor_time_off (instructor_id, starts_on, ends_on);
alter table public.instructor_time_off enable row level security;
drop policy if exists time_off_read on public.instructor_time_off;
create policy time_off_read on public.instructor_time_off for select to authenticated
  using (public.is_admin() or exists (select 1 from public.instructors i where i.id = instructor_id and i.profile_id = auth.uid()));
grant select on public.instructor_time_off to authenticated;

-- The instructor's scheduled classes in a date range (Dublin dates).
create or replace function public._time_off_sessions(p_instructor uuid, p_from date, p_to date)
returns setof public.class_sessions language sql stable security definer set search_path = public, pg_temp as $$
  select * from public.class_sessions s
  where s.instructor_id = p_instructor and s.status = 'scheduled' and s.starts_at > now()
    and (s.starts_at at time zone 'Europe/Dublin')::date between p_from and p_to
  order by s.starts_at;
$$;

create or replace function public._tell_admins(p_kind text, p_payload jsonb, p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select p.id, p_kind, p_payload, p_key || ':' || p.id from public.profiles p where p.role = 'admin'
  on conflict (dedupe_key) do nothing;
$$;

create or replace function public.request_time_off(p_from date, p_to date, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i public.instructors;
  t public.instructor_time_off;
  n int;
begin
  select * into i from public.instructors where profile_id = auth.uid() and is_active;
  if not found then perform public._fail('not_an_instructor'); end if;
  if p_from is null or p_to is null or p_to < p_from then perform public._fail('invalid_date_range'); end if;
  if p_from < public._local_date(now()) then perform public._fail('time_off_in_past'); end if;
  if p_to - p_from > 90 then perform public._fail('time_off_too_long'); end if;
  if exists (select 1 from public.instructor_time_off where instructor_id = i.id and status in ('pending', 'approved')
             and starts_on <= p_to and ends_on >= p_from) then perform public._fail('time_off_overlaps'); end if;
  insert into public.instructor_time_off (instructor_id, requested_by, starts_on, ends_on, note)
  values (i.id, auth.uid(), p_from, p_to, nullif(btrim(p_note), '')) returning * into t;
  select count(*) into n from public._time_off_sessions(i.id, p_from, p_to);
  perform public._tell_admins('time_off_requested', jsonb_build_object('id', t.id, 'instructor', i.full_name,
    'from', p_from, 'to', p_to, 'note', t.note, 'classes', n), 'time_off_req:' || t.id);
  perform public._audit('time_off_requested', 'instructor_time_off', t.id::text, jsonb_build_object('from', p_from, 'to', p_to));
  return jsonb_build_object('id', t.id, 'classes', n);
end;
$$;

create or replace function public.cancel_time_off(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.instructor_time_off t set status = 'cancelled'
  where t.id = p_id and t.status = 'pending'
    and exists (select 1 from public.instructors i where i.id = t.instructor_id and i.profile_id = auth.uid());
  if not found then perform public._fail('time_off_not_found'); end if;
end;
$$;

create or replace function public.admin_decide_time_off(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t public.instructor_time_off;
  i public.instructors;
  n int;
begin
  perform public._require_admin();
  update public.instructor_time_off set status = case when p_approve then 'approved' else 'declined' end,
    admin_note = nullif(btrim(p_note), ''), decided_by = auth.uid(), decided_at = now()
  where id = p_id and status = 'pending' returning * into t;
  if not found then perform public._fail('time_off_not_found'); end if;
  select * into i from public.instructors where id = t.instructor_id;
  select count(*) into n from public._time_off_sessions(i.id, t.starts_on, t.ends_on);
  if i.profile_id is not null then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (i.profile_id, 'time_off_decided', jsonb_build_object('approved', p_approve, 'from', t.starts_on, 'to', t.ends_on, 'note', t.admin_note),
      'time_off_dec:' || t.id) on conflict (dedupe_key) do nothing;
  end if;
  perform public._audit(case when p_approve then 'time_off_approved' else 'time_off_declined' end, 'instructor_time_off', t.id::text, '{}'::jsonb);
  return jsonb_build_object('status', t.status, 'classes', n);
end;
$$;

-- Admin: every future class still taught by someone on an approved holiday (needs a cover or cancelling).
create or replace function public.admin_classes_needing_cover()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('session_id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'booked_count', s.booked_count, 'instructor_id', s.instructor_id, 'instructor', i.full_name, 'time_off_id', t.id,
      'style_id', s.style_id) order by s.starts_at), '[]')
    from public.instructor_time_off t
    join public.instructors i on i.id = t.instructor_id
    cross join lateral public._time_off_sessions(t.instructor_id, t.starts_on, t.ends_on) s
    where t.status = 'approved' and t.ends_on >= public._local_date(now()));
end;
$$;

revoke all on function public._time_off_sessions(uuid, date, date), public._tell_admins(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.request_time_off(date, date, text), public.cancel_time_off(uuid), public.admin_decide_time_off(uuid, boolean, text), public.admin_classes_needing_cover() from public, anon;
grant execute on function public.request_time_off(date, date, text), public.cancel_time_off(uuid), public.admin_decide_time_off(uuid, boolean, text), public.admin_classes_needing_cover() to authenticated;
