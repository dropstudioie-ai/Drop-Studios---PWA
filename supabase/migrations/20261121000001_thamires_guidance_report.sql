-- Thamires: asks the owner when someone brings an out-of-the-ordinary question (and remembers the answer),
-- and sends the owner a daily report of what people talked about.

alter table public.assistant_messages
  add column if not exists topic text,
  add column if not exists out_of_ordinary boolean not null default false;

alter table public.assistant_settings
  add column if not exists daily_report boolean not null default true,
  add column if not exists report_hour int not null default 21 check (report_hour between 12 and 23);

-- Questions Thamires couldn't answer from what she knows, and the owner's answers (her "guidance").
create table if not exists public.assistant_guidance (
  id uuid primary key default gen_random_uuid(),
  question text not null,                 -- neutral English summary, e.g. "Can I bring my dog to class?"
  asked_text text,                        -- what the person actually wrote
  answer text,                            -- the owner's guidance
  status text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  thread_id uuid references public.assistant_threads(id) on delete set null,
  message_id uuid references public.assistant_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid references public.profiles(id) on delete set null
);
create index if not exists assistant_guidance_status on public.assistant_guidance (status, created_at desc);

create table if not exists public.assistant_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  stats jsonb not null default '{}',
  summary text,
  themes jsonb not null default '[]',
  suggestions jsonb not null default '[]',
  created_at timestamptz not null default now()
);

alter table public.assistant_guidance enable row level security;
alter table public.assistant_reports enable row level security;
drop policy if exists assistant_guidance_admin on public.assistant_guidance;
create policy assistant_guidance_admin on public.assistant_guidance for select to authenticated using (public.is_admin());
drop policy if exists assistant_reports_admin on public.assistant_reports;
create policy assistant_reports_admin on public.assistant_reports for select to authenticated using (public.is_admin());
grant select on public.assistant_guidance, public.assistant_reports to authenticated;

-- What Thamires knows now includes the owner's answers to earlier questions.
create or replace function public.assistant_knowledge()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'today', to_char(now() at time zone 'Europe/Dublin', 'FMDay DD FMMonth YYYY'),
    'studio', jsonb_build_object('name', 'Drop Studios', 'address', '13 Sackville Place, Dublin 1, D01 (city centre, near O''Connell Street)',
      'website', 'https://www.dropstudios.ie', 'email', 'dropstudioie@gmail.com'),
    'policies', (select jsonb_build_object(
        'booking_window_days', s.booking_window_days,
        'free_cancellation_minutes_before', s.cancellation_cutoff_minutes,
        'bring_a_friend', 'First-time customers buying a Drop In can bring a friend free (2 spots for the price of one).',
        'first_class', 'New members can book their first class without a profile photo; we take it at reception.',
        'payments', 'Card, Apple Pay and Google Pay, online through Square.',
        'app', 'The Drop app works in any phone browser and can be added to the home screen (no app store): https://www.dropstudios.ie/app')
      from public.app_settings s limit 1),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'label', p.display_label, 'price_eur', p.price_cents / 100.0,
        'classes', p.class_count, 'first_time_only', p.first_time_only, 'link', 'https://www.dropstudios.ie/checkout/' || p.code) order by p.sort_order), '[]')
      from public.membership_plans p where p.is_active),
    'styles', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'level', d.level, 'description', d.description,
        'what_to_wear', d.what_to_wear, 'what_to_bring', d.what_to_bring, 'first_class', d.first_class,
        'drop_in_eur', d.drop_in_price_cents / 100.0, 'page', 'https://www.dropstudios.ie/classes/' || d.slug) order by d.sort_order), '[]')
      from public.dance_styles d where d.is_active),
    'next_14_days', (select coalesce(jsonb_agg(jsonb_build_object(
        'when', to_char(s.starts_at at time zone 'Europe/Dublin', 'Dy DD Mon HH24:MI'),
        'class', s.title, 'style', d.name, 'instructor', i.full_name,
        'availability', public._availability(s.capacity, s.booked_count),
        'special', (select e.title from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1),
        'book', 'https://www.dropstudios.ie/timetable?class=' || s.id) order by s.starts_at), '[]')
      from public.class_sessions s left join public.dance_styles d on d.id = s.style_id left join public.instructors i on i.id = s.instructor_id
      where s.status = 'scheduled' and s.starts_at > now() and s.starts_at < now() + interval '14 days'),
    'notes', (select notes from public.assistant_settings),
    'owner_guidance', (select coalesce(jsonb_agg(jsonb_build_object('question', g.question, 'answer', g.answer) order by g.answered_at desc), '[]')
      from (select question, answer, answered_at from public.assistant_guidance where status = 'answered' order by answered_at desc limit 60) g));
$$;

-- Guidance requests and the daily report go to the owner (admins with full access), not to every manager.
create or replace function public._assistant_notify_owner(p_kind text, p_payload jsonb, p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select p.id, p_kind, p_payload, p_key || ':' || p.id from public.profiles p where p.role = 'admin' and p.finance_access
  on conflict (dedupe_key) do nothing;
$$;

revoke all on function public.assistant_knowledge(), public._assistant_notify_owner(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.assistant_knowledge(), public._assistant_notify_owner(text, jsonb, text) to service_role;
