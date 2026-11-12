-- Drop Studios — themed special classes and workshops organised by instructors.
--
-- * important_dates: the studio's year of themes (fixed dates, month-long
--   themes and Easter-based dates). Admins edit them.
-- * In the last week of each month every linked instructor is told about next
--   month's dates and asked to organise something.
-- * studio_events:
--     special_class — an instructor's own scheduled class, same day and time,
--                     with a theme. Published straight away.
--     workshop      — a new paid event outside the timetable. Must fit the
--                     studio's free time; an admin approves it, which puts it
--                     on the timetable as a ticketed session (member and
--                     non-member prices).
-- * Publishing tells everyone who booked one of that instructor's classes in
--   the last 3 months, and gives everyone booked on it the details (what to
--   wear is encouraged, never required). Later bookers get the details too,
--   and everyone booked gets a reminder the day before.

-- ---------------------------------------------------------------------------
-- The year of themes
-- ---------------------------------------------------------------------------
create table public.important_dates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  emoji text,
  month int not null check (month between 1 and 12),
  day int check (day between 1 and 31),            -- null: a theme for the whole month
  easter_offset int,                                -- moveable: days from Easter Sunday (month is only for sorting)
  ideas text,                                       -- suggestions shown to instructors
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.important_dates enable row level security;
create policy important_dates_read on public.important_dates for select to authenticated using (public.is_staff() or public.is_admin());
create policy important_dates_admin on public.important_dates for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.important_dates to authenticated;

-- Easter Sunday (Gregorian, anonymous algorithm).
create or replace function public._easter(y int)
returns date
language plpgsql
immutable
as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mon int; dy int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  mon := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(y, mon, dy);
end;
$$;

-- When a date falls in a year (null for a month-long theme).
create or replace function public._important_date_on(d public.important_dates, y int)
returns date
language sql
immutable
as $$
  select case
    when d.easter_offset is not null then public._easter(y) + d.easter_offset
    when d.day is not null then make_date(y, d.month, least(d.day, extract(day from (make_date(y, d.month, 1) + interval '1 month - 1 day'))::int))
  end;
$$;

-- Themes in a calendar month: [{id, name, emoji, ideas, on}] (on is null for month-long).
create or replace function public._themes_for_month(p_first date)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'emoji', x.emoji, 'ideas', x.ideas, 'on', x.on_day)
           order by x.on_day nulls first, x.name), '[]'::jsonb)
  from (
    select d.id, d.name, d.emoji, d.ideas, public._important_date_on(d, extract(year from p_first)::int) as on_day, d.month
    from public.important_dates d where d.is_active
  ) x
  where (x.on_day is not null and date_trunc('month', x.on_day)::date = p_first)
     or (x.on_day is null and x.month = extract(month from p_first)::int);
$$;

-- Staff: this month's and the next two months' themes.
create or replace function public.upcoming_themes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_first date := date_trunc('month', public._local_date(now()))::date;
begin
  if auth.uid() is null or not (public.is_staff() or public.is_admin()) then perform public._fail('forbidden'); end if;
  return (
    select jsonb_agg(jsonb_build_object('month', m, 'themes', public._themes_for_month(m)) order by m)
    from (select (v_first + make_interval(months => n))::date as m from generate_series(0, 2) n) months
  );
end;
$$;

insert into public.important_dates (name, emoji, month, day, easter_offset, ideas) values
  ('New Year''s Day', '🎆', 1, 1, null, 'New year, new moves: a fresh-start class. Members share a dance goal for the year.'),
  ('St Brigid''s Day', '🌾', 2, 1, null, 'Ireland''s newest bank holiday: celebrate Irish women and new beginnings.'),
  ('Valentine''s Day', '💘', 2, 14, null, 'Red and pink, love songs, a partner or Galentine''s routine. Bring your bestie.'),
  ('International Women''s Day', '💪', 3, 8, null, 'An all female-artists playlist, purple dress code, bring a friend.'),
  ('Mother''s Day', '💐', 3, null, -21, 'Bring your mum (or someone who''s been a mum to you) to class.'),
  ('St Patrick''s Day', '☘️', 3, 17, null, 'Wear green, Irish pop hits, a little céilí twist in the choreography.'),
  ('Easter', '🐣', 4, null, 0, 'Pastel colours, an Easter egg hunt after class, chocolate treats.'),
  ('International Dance Day', '💃', 4, 29, null, 'Celebrate dance: open class, bring a friend, film a group routine.'),
  ('Eurovision', '🎤', 5, null, null, 'Eurovision hits, glitter and flags. Everyone picks a country to cheer for.'),
  ('Pride Month', '🏳️‍🌈', 6, null, null, 'Rainbow dress code and Pride anthems before Dublin Pride at the end of June.'),
  ('World Music Day', '🎶', 6, 21, null, 'Longest day of the year: a mix of music from around the world.'),
  ('Summer Tropical Party', '🌴', 7, null, null, 'Hawaiian shirts, tropical playlist, fruit snacks.'),
  ('Throwback Festival', '🎪', 8, null, null, '90s and 2000s throwback, festival glitter.'),
  ('Back to Dance', '📚', 9, null, null, 'Back-to-routine class: new term goals, bring a friend.'),
  ('Halloween', '🎃', 10, 31, null, 'Costumes, a spooky routine (Thriller!), dark lights.'),
  ('All Black (Black Friday)', '🖤', 11, null, null, 'Everyone in black, UV lights, a high-energy all black class.'),
  ('Christmas', '🎄', 12, 25, null, 'Christmas jumpers, festive hits, mince pies after class.'),
  ('New Year''s Eve', '✨', 12, 31, null, 'Glitter and gold, a countdown routine.');

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------
alter table public.class_sessions add column member_ticket_price_cents int check (member_ticket_price_cents >= 0);

-- Workshop ticket money: after Square's processing fee, the instructor gets
-- their share and the rest is the studio's. Each workshop keeps the share it
-- was requested under. Square reports the fee on the payment (often a moment
-- after it completes); the webhook and the hourly job record it.
alter table public.payments add column provider_fee_cents int check (provider_fee_cents >= 0);

create or replace function public.record_payment_fee(p_payment_id uuid, p_fee_cents int)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.payments set provider_fee_cents = p_fee_cents where id = p_payment_id and p_fee_cents >= 0;
$$;

alter table public.app_settings add column workshop_instructor_share_pct int not null default 70
  check (workshop_instructor_share_pct between 0 and 100);

create table public.studio_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('special_class', 'workshop')),
  status text not null default 'pending' check (status in ('pending', 'published', 'declined', 'cancelled')),
  instructor_id uuid not null references public.instructors (id),
  created_by uuid not null references public.profiles (id),
  important_date_id uuid references public.important_dates (id) on delete set null,
  title text not null check (length(btrim(title)) between 2 and 80),
  description text check (length(description) <= 1000),
  dress_code text check (length(dress_code) <= 200),
  decorations text check (length(decorations) <= 1000),
  extras text check (length(extras) <= 1000),
  session_id uuid references public.class_sessions (id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  style_id uuid references public.dance_styles (id),
  capacity int check (capacity between 1 and 200),
  price_cents int check (price_cents >= 0),
  member_price_cents int check (member_price_cents >= 0),
  admin_note text,
  instructor_share_pct int not null default 70 check (instructor_share_pct between 0 and 100),
  announced_to int not null default 0,
  decided_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  check (kind = 'special_class' or (starts_at is not null and ends_at > starts_at and style_id is not null and capacity is not null and price_cents is not null))
);
create unique index studio_events_one_theme_per_class on public.studio_events (session_id)
  where status in ('pending', 'published');
create index studio_events_instructor_idx on public.studio_events (instructor_id, created_at desc);
alter table public.studio_events enable row level security;
create policy studio_events_read on public.studio_events for select to authenticated using (
  public.is_admin() or instructor_id in (select id from public.instructors where profile_id = auth.uid())
);
grant select on public.studio_events to authenticated;

-- The signed-in instructor's own instructor record.
create or replace function public._my_instructor_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.instructors where profile_id = auth.uid() and is_active order by created_at limit 1;
$$;

create or replace function public._is_member(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_uid and m.admin_status = 'valid' and public.state(m) in ('active', 'paused', 'pending_activation')
  );
$$;

-- What members are told (public fields only).
create or replace function public._event_payload(e public.studio_events)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event_id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description, 'dress_code', e.dress_code,
    'instructor', (select full_name from public.instructors where id = e.instructor_id),
    'session_id', s.id, 'class_title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
    'price_cents', case when s.is_special then s.ticket_price_cents end,
    'member_price_cents', case when s.is_special then s.member_ticket_price_cents end)
  from public.class_sessions s where s.id = e.session_id;
$$;

-- People who booked one of the instructor's classes in the last 3 months.
create or replace function public._event_audience(p_instructor_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct b.user_id
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  where s.instructor_id = p_instructor_id
    and b.status in ('booked', 'attended', 'no_show', 'late_cancelled')
    and s.starts_at >= now() - interval '3 months'
    and b.user_id not in (select profile_id from public.instructors where id = p_instructor_id and profile_id is not null);
$$;

create or replace function public.event_audience_count(p_instructor_id uuid default null)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_instr uuid := coalesce(case when public.is_admin() then p_instructor_id end, public._my_instructor_id());
begin
  if v_instr is null then perform public._fail('not_an_instructor'); end if;
  return (select count(*) from public._event_audience(v_instr));
end;
$$;

-- Publish: details to everyone booked, an announcement to the instructor's people.
create or replace function public._announce_event(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events;
  v_payload jsonb;
  v_n int;
begin
  select * into e from public.studio_events where id = p_event_id;
  v_payload := public._event_payload(e);

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select b.user_id, 'event_details', v_payload, format('evdet:%s:%s', e.id, b.user_id)
  from public.bookings b where b.session_id = e.session_id and b.status = 'booked'
  on conflict (dedupe_key) do nothing;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select a.user_id, 'event_announced', v_payload, format('evann:%s:%s', e.id, a.user_id)
  from public._event_audience(e.instructor_id) a
  where not exists (select 1 from public.bookings b where b.session_id = e.session_id and b.user_id = a.user_id and b.status = 'booked')
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;

  update public.studio_events set announced_to = v_n where id = e.id;
  return v_n;
end;
$$;

-- Studio time already taken on a day (classes and workshop requests).
create or replace function public.studio_busy(p_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Europe/Dublin');
  v_from timestamptz := p_day::timestamp at time zone v_tz;
  v_to timestamptz := (p_day + 1)::timestamp at time zone v_tz;
begin
  if auth.uid() is null or not (public.is_staff() or public.is_admin()) then perform public._fail('forbidden'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'starts_at', t.starts_at, 'ends_at', t.ends_at, 'pending', t.pending) order by t.starts_at), '[]'::jsonb)
    from (
      select s.title, s.starts_at, s.ends_at, false as pending from public.class_sessions s
      where s.status = 'scheduled' and s.starts_at < v_to and s.ends_at > v_from
      union all
      select e.title, e.starts_at, e.ends_at, true from public.studio_events e
      where e.kind = 'workshop' and e.status = 'pending' and e.starts_at < v_to and e.ends_at > v_from
    ) t
  );
end;
$$;

create or replace function public._studio_clash(p_from timestamptz, p_to timestamptz, p_ignore_event uuid default null)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.title from public.class_sessions s
     where s.status = 'scheduled' and s.starts_at < p_to and s.ends_at > p_from order by s.starts_at limit 1),
    (select e.title from public.studio_events e
     where e.kind = 'workshop' and e.status = 'pending' and e.id is distinct from p_ignore_event
       and e.starts_at < p_to and e.ends_at > p_from order by e.starts_at limit 1));
$$;

create or replace function public._clean(t text) returns text language sql immutable as $$ select nullif(btrim(coalesce(t, '')), '') $$;

-- Instructor (or admin for an instructor): put a theme on one of their classes.
create or replace function public.organise_special_class(
  p_session_id uuid,
  p_title text,
  p_description text default null,
  p_dress_code text default null,
  p_decorations text default null,
  p_extras text default null,
  p_important_date_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  v_id uuid;
  v_n int;
  v_booked int;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  perform public._require_staff_dob();
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;
  if not (public.is_admin() or coalesce(s.instructor_id = public._my_instructor_id(), false)) then perform public._fail('forbidden'); end if;
  if s.instructor_id is null then perform public._fail('not_an_instructor'); end if;
  if s.status <> 'scheduled' then perform public._fail('session_cancelled'); end if;
  if s.starts_at <= now() then perform public._fail('session_started'); end if;
  if s.is_special then perform public._fail('already_an_event'); end if;
  if public._clean(p_title) is null then perform public._fail('title_required'); end if;
  if exists (select 1 from public.studio_events where session_id = s.id and status in ('pending', 'published')) then
    perform public._fail('already_an_event');
  end if;

  insert into public.studio_events (kind, status, instructor_id, created_by, important_date_id, title, description, dress_code,
    decorations, extras, session_id, published_at)
  values ('special_class', 'published', s.instructor_id, auth.uid(), p_important_date_id, btrim(p_title), public._clean(p_description),
    public._clean(p_dress_code), public._clean(p_decorations), public._clean(p_extras), s.id, now())
  returning id into v_id;

  v_n := public._announce_event(v_id);
  select count(*) into v_booked from public.bookings where session_id = s.id and status = 'booked';

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select a.id, 'event_organised', public._event_payload(e) || jsonb_build_object('decorations', e.decorations, 'extras', e.extras),
         format('evorg:%s:%s', e.id, a.id)
  from public.studio_events e, public.profiles a
  where e.id = v_id and a.role = 'admin' and a.id <> auth.uid()
  on conflict (dedupe_key) do nothing;

  perform public._audit('event_published', 'studio_event', v_id::text, jsonb_build_object('session_id', s.id, 'title', p_title));
  return jsonb_build_object('event_id', v_id, 'announced', v_n, 'booked_told', v_booked);
end;
$$;

-- Instructor: ask for a workshop / gathering outside the timetable.
create or replace function public.request_workshop(
  p_title text,
  p_style_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity int,
  p_price_cents int,
  p_member_price_cents int default null,
  p_description text default null,
  p_dress_code text default null,
  p_decorations text default null,
  p_extras text default null,
  p_important_date_id uuid default null,
  p_instructor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_instr uuid := coalesce(case when public.is_admin() then p_instructor_id end, public._my_instructor_id());
  v_clash text;
  v_id uuid;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  perform public._require_staff_dob();
  if v_instr is null then perform public._fail('not_an_instructor'); end if;
  if public._clean(p_title) is null then perform public._fail('title_required'); end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '8 hours' then
    perform public._fail('invalid_session_times');
  end if;
  if p_starts_at < now() + interval '3 days' then perform public._fail('workshop_too_soon'); end if;
  if p_capacity is null or p_capacity < 1 or p_capacity > 200 then perform public._fail('invalid_capacity'); end if;
  if p_price_cents is null or p_price_cents < 0 or (p_member_price_cents is not null and (p_member_price_cents < 0 or p_member_price_cents > p_price_cents)) then
    perform public._fail('invalid_price');
  end if;
  if not exists (select 1 from public.dance_styles where id = p_style_id) then perform public._fail('style_not_found'); end if;
  v_clash := public._studio_clash(p_starts_at, p_ends_at);
  if v_clash is not null then perform public._fail('studio_busy'); end if;

  insert into public.studio_events (kind, status, instructor_id, created_by, important_date_id, title, description, dress_code,
    decorations, extras, starts_at, ends_at, style_id, capacity, price_cents, member_price_cents, instructor_share_pct)
  values ('workshop', 'pending', v_instr, auth.uid(), p_important_date_id, btrim(p_title), public._clean(p_description),
    public._clean(p_dress_code), public._clean(p_decorations), public._clean(p_extras), p_starts_at, p_ends_at, p_style_id,
    p_capacity, p_price_cents, p_member_price_cents, (public._settings()).workshop_instructor_share_pct)
  returning id into v_id;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select a.id, 'event_request', jsonb_build_object('event_id', v_id, 'title', btrim(p_title), 'starts_at', p_starts_at, 'ends_at', p_ends_at,
           'instructor', (select full_name from public.instructors where id = v_instr), 'price_cents', p_price_cents, 'member_price_cents', p_member_price_cents),
         format('evreq:%s:%s', v_id, a.id)
  from public.profiles a where a.role = 'admin' and a.id <> auth.uid()
  on conflict (dedupe_key) do nothing;

  perform public._audit('workshop_requested', 'studio_event', v_id::text, jsonb_build_object('title', p_title, 'starts_at', p_starts_at));
  return jsonb_build_object('event_id', v_id, 'status', 'pending');
end;
$$;

-- Admin: approve (puts it on the timetable and announces it) or decline.
create or replace function public.admin_decide_workshop(p_event_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events;
  v_session uuid;
  v_n int := 0;
  v_room text;
begin
  perform public._require_admin();
  select * into e from public.studio_events where id = p_event_id for update;
  if not found then perform public._fail('event_not_found'); end if;
  if e.kind <> 'workshop' or e.status <> 'pending' then perform public._fail('event_not_pending'); end if;

  if p_approve then
    if e.starts_at <= now() then perform public._fail('session_started'); end if;
    if public._studio_clash(e.starts_at, e.ends_at, e.id) is not null then perform public._fail('studio_busy'); end if;
    select room into v_room from public.class_sessions where room is not null group by room order by count(*) desc limit 1;
    insert into public.class_sessions (title, style_id, instructor_id, starts_at, ends_at, capacity, room, is_special,
      ticket_price_cents, member_ticket_price_cents)
    values (e.title, e.style_id, e.instructor_id, e.starts_at, e.ends_at, e.capacity, v_room, true, e.price_cents, e.member_price_cents)
    returning id into v_session;
    update public.studio_events set status = 'published', session_id = v_session, published_at = now(), decided_by = auth.uid(),
      admin_note = public._clean(p_note) where id = e.id;
    v_n := public._announce_event(e.id);
  else
    update public.studio_events set status = 'declined', decided_by = auth.uid(), admin_note = public._clean(p_note) where id = e.id;
  end if;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select i.profile_id, 'event_decided', jsonb_build_object('event_id', e.id, 'title', e.title, 'starts_at', e.starts_at,
           'approved', p_approve, 'note', public._clean(p_note), 'announced', v_n),
         format('evdec:%s', e.id)
  from public.instructors i where i.id = e.instructor_id and i.profile_id is not null and i.profile_id <> auth.uid()
  on conflict (dedupe_key) do nothing;

  perform public._audit(case when p_approve then 'workshop_approved' else 'workshop_declined' end, 'studio_event', e.id::text,
    jsonb_build_object('note', p_note, 'session_id', v_session));
  return jsonb_build_object('ok', true, 'session_id', v_session, 'announced', v_n);
end;
$$;

-- Instructor or admin: fix the details (no new announcement; the app and the
-- day-before reminder show the latest).
create or replace function public.update_event_details(
  p_event_id uuid, p_description text, p_dress_code text, p_decorations text, p_extras text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare e public.studio_events;
begin
  select * into e from public.studio_events where id = p_event_id for update;
  if not found then perform public._fail('event_not_found'); end if;
  if not (public.is_admin() or coalesce(e.instructor_id = public._my_instructor_id(), false)) then perform public._fail('forbidden'); end if;
  if e.status not in ('pending', 'published') then perform public._fail('event_not_pending'); end if;
  update public.studio_events set description = public._clean(p_description), dress_code = public._clean(p_dress_code),
    decorations = public._clean(p_decorations), extras = public._clean(p_extras) where id = e.id;
end;
$$;

-- Instructor or admin: drop the theme from a class, or withdraw a workshop
-- request. A published workshop is cancelled by an admin like any class.
create or replace function public.cancel_event(p_event_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events;
  v_n int := 0;
begin
  select * into e from public.studio_events where id = p_event_id for update;
  if not found then perform public._fail('event_not_found'); end if;
  if not (public.is_admin() or coalesce(e.instructor_id = public._my_instructor_id(), false)) then perform public._fail('forbidden'); end if;
  if e.status not in ('pending', 'published') then perform public._fail('event_not_pending'); end if;
  if e.kind = 'workshop' and e.status = 'published' then perform public._fail('workshop_cancel_by_admin'); end if;

  update public.studio_events set status = 'cancelled', admin_note = coalesce(public._clean(p_reason), admin_note) where id = e.id;
  if e.kind = 'special_class' then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select b.user_id, 'event_cancelled', public._event_payload(e) || jsonb_build_object('reason', public._clean(p_reason)),
           format('evcan:%s:%s', e.id, b.user_id)
    from public.bookings b where b.session_id = e.session_id and b.status = 'booked'
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
  end if;
  perform public._audit('event_cancelled', 'studio_event', e.id::text, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'notified', v_n);
end;
$$;

-- A cancelled class ends its event too.
create or replace function public._session_cancel_ends_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.studio_events set status = 'cancelled' where session_id = new.id and status in ('pending', 'published');
  end if;
  return new;
end;
$$;
create trigger class_sessions_cancel_event after update of status on public.class_sessions
  for each row execute function public._session_cancel_ends_event();

-- Booked onto a themed class or workshop later: send the details.
create or replace function public._booking_event_details()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'booked' and (tg_op = 'INSERT' or old.status is distinct from 'booked') then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select new.user_id, 'event_details', public._event_payload(e), format('evdet:%s:%s', e.id, new.user_id)
    from public.studio_events e
    where e.session_id = new.session_id and e.status = 'published'
    on conflict (dedupe_key) do nothing;
  end if;
  return new;
end;
$$;
create trigger bookings_event_details after insert or update of status on public.bookings
  for each row execute function public._booking_event_details();

-- Monthly nudge to instructors (last week of the month) and the day-before reminder.
create or replace function public.queue_event_notifications()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Europe/Dublin');
  v_local timestamp := now() at time zone v_tz;
  v_today date := v_local::date;
  v_next date := (date_trunc('month', v_today) + interval '1 month')::date;
  v_total int := 0;
  v_n int;
begin
  if v_local::time < time '10:00' then return 0; end if;

  -- The last 7 days of the month start at (first of next month - 7).
  if v_today >= v_next - 7 then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select i.profile_id, 'event_prompt',
           jsonb_build_object('month', v_next, 'themes', public._themes_for_month(v_next)),
           format('evprompt:%s:%s', i.id, to_char(v_next, 'YYYY-MM'))
    from public.instructors i
    where i.is_active and i.profile_id is not null
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end if;

  -- From 12:00 the day before.
  if v_local::time >= time '12:00' then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select b.user_id, 'event_reminder', public._event_payload(e), format('evrem:%s:%s', e.id, b.user_id)
    from public.studio_events e
    join public.class_sessions s on s.id = e.session_id and s.status = 'scheduled'
    join public.bookings b on b.session_id = s.id and b.status = 'booked'
    where e.status = 'published' and public._local_date(s.starts_at) = v_today + 1
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end if;
  return v_total;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drop-event-notifications', '*/15 * * * *', $job$select public.queue_event_notifications()$job$);
  end if;
end;
$$;

-- Lists ------------------------------------------------------------------------
create or replace function public._event_row(e public.studio_events)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with money as (
    select count(*) as sold,
           coalesce(sum(p.amount_cents), 0)::int as revenue,
           coalesce(sum(p.provider_fee_cents), 0)::int as fees,
           count(*) filter (where p.provider = 'square' and p.provider_fee_cents is null) as fees_pending
    from public.payments p
    where e.kind = 'workshop' and p.session_id = e.session_id and p.status = 'succeeded' and not p.is_test
  ), net as (
    select m.*, greatest(m.revenue - m.fees, 0) as net, round(greatest(m.revenue - m.fees, 0) * e.instructor_share_pct / 100.0)::int as mine
    from money m
  )
  select to_jsonb(e) || jsonb_build_object(
    'instructor', (select full_name from public.instructors where id = e.instructor_id),
    'theme', (select jsonb_build_object('name', d.name, 'emoji', d.emoji) from public.important_dates d where d.id = e.important_date_id),
    'session', (select jsonb_build_object('id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
                  'booked_count', s.booked_count, 'capacity', s.capacity, 'status', s.status)
                from public.class_sessions s where s.id = e.session_id),
    'tickets_sold', n.sold,
    'ticket_revenue_cents', n.revenue,
    'fees_cents', n.fees,
    'fees_pending', n.fees_pending,
    'net_revenue_cents', n.net,
    'instructor_earnings_cents', n.mine,
    'studio_earnings_cents', n.net - n.mine)
  from net n;
$$;

create or replace function public.my_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_instr uuid := public._my_instructor_id();
begin
  if v_instr is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(public._event_row(e) order by coalesce(e.starts_at, (select starts_at from public.class_sessions where id = e.session_id)) desc), '[]'::jsonb)
          from public.studio_events e where e.instructor_id = v_instr and e.created_at > now() - interval '1 year');
end;
$$;

create or replace function public.admin_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(public._event_row(e) order by (e.status = 'pending') desc,
            coalesce(e.starts_at, (select starts_at from public.class_sessions where id = e.session_id)) desc), '[]'::jsonb)
          from public.studio_events e where e.created_at > now() - interval '1 year');
end;
$$;

-- Timetable: include the theme so members see it on the class.
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
      'member_ticket_price_cents', s.member_ticket_price_cents,
      'status', s.status, 'cancel_reason', s.cancel_reason,
      'availability', public._availability(s.capacity, s.booked_count),
      'style', (select jsonb_build_object('id', d.id, 'name', d.name, 'color', d.color, 'slug', d.slug)
                from public.dance_styles d where d.id = s.style_id),
      'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name)
                     from public.instructors i where i.id = s.instructor_id),
      'event', (select jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
                  'dress_code', e.dress_code, 'emoji', (select emoji from public.important_dates where id = e.important_date_id))
                from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1)
    ) order by s.starts_at), '[]'::jsonb)
  from public.class_sessions s
  where (p_session_id is not null and s.id = p_session_id)
     or (p_session_id is null and s.starts_at >= p_from and s.starts_at < p_to
         and p_to - p_from <= interval '62 days');
$$;

-- ---------------------------------------------------------------------------
-- Prices: members can get a lower workshop price
-- ---------------------------------------------------------------------------
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
      'member_ticket_price_cents', case when s.is_special then s.member_ticket_price_cents end,
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
    'ticket_price_cents', case when s.is_special then
      case when s.member_ticket_price_cents is not null and public._is_member(v_uid) then s.member_ticket_price_cents else s.ticket_price_cents end end,
    'ticket_is_member_price', s.is_special and s.member_ticket_price_cents is not null and public._is_member(v_uid),
    'member_ticket_price_cents', case when s.is_special then s.member_ticket_price_cents end,
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

create or replace function public.create_ticket_checkout(
  p_session_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'square'
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

    insert into public.bookings (user_id, session_id, status, hold_expires_at)
    values (v_uid, s.id, 'pending_payment', now() + interval '35 minutes')
    returning id into v_booking_id;
    update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

    insert into public.payments (
      user_id, kind, session_id, booking_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, v_kind, s.id, v_booking_id,
      jsonb_build_object('kind', v_kind, 'plan_name', v_label || s.title, 'title', s.title,
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

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public._easter(int), public._important_date_on(public.important_dates, int), public._themes_for_month(date),
  public._my_instructor_id(), public._is_member(uuid), public._event_payload(public.studio_events), public._event_audience(uuid),
  public._announce_event(uuid), public._studio_clash(timestamptz, timestamptz, uuid), public._clean(text),
  public._session_cancel_ends_event(), public._booking_event_details(), public.queue_event_notifications(),
  public._event_row(public.studio_events)
  from public, anon, authenticated;
revoke execute on function public.upcoming_themes(), public.event_audience_count(uuid), public.studio_busy(date),
  public.organise_special_class(uuid, text, text, text, text, text, uuid),
  public.request_workshop(text, uuid, timestamptz, timestamptz, int, int, int, text, text, text, text, uuid, uuid),
  public.admin_decide_workshop(uuid, boolean, text), public.update_event_details(uuid, text, text, text, text),
  public.cancel_event(uuid, text), public.my_events(), public.admin_events()
  from public, anon;
grant execute on function public.upcoming_themes(), public.event_audience_count(uuid), public.studio_busy(date),
  public.organise_special_class(uuid, text, text, text, text, text, uuid),
  public.request_workshop(text, uuid, timestamptz, timestamptz, int, int, int, text, text, text, text, uuid, uuid),
  public.admin_decide_workshop(uuid, boolean, text), public.update_event_details(uuid, text, text, text, text),
  public.cancel_event(uuid, text), public.my_events(), public.admin_events()
  to authenticated;
grant execute on function public.queue_event_notifications() to service_role;
revoke execute on function public.record_payment_fee(uuid, int) from public, anon, authenticated;
grant execute on function public.record_payment_fee(uuid, int) to service_role;
