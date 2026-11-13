-- Thamires: Drop's AI assistant for Instagram (DM replies, daily Stories, thanking people who tag Drop).
-- Everything she drafts is stored here; admins approve, edit or reject it, or switch on auto-replies.
-- Only the edge function (service role) and admins can read or change these tables.

create table if not exists public.assistant_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,          -- master switch
  auto_reply boolean not null default false,       -- send simple DM replies without approval
  auto_tag_thanks boolean not null default false,  -- send thank-yous to tags without approval
  daily_story boolean not null default true,       -- prepare a Story every morning
  story_hour int not null default 10 check (story_hour between 6 and 20),
  notes text,                                      -- extra facts/instructions from the owner
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
insert into public.assistant_settings (id) values (true) on conflict do nothing;

create table if not exists public.assistant_threads (
  id uuid primary key default gen_random_uuid(),
  ig_user_id text not null unique,
  username text,
  display_name text,
  status text not null default 'open' check (status in ('open', 'needs_human', 'closed')),
  last_inbound_at timestamptz,
  last_message_at timestamptz not null default now(),
  disclosed boolean not null default false,  -- has Thamires said she's an AI assistant in this chat?
  language text,                             -- the language this person prefers (e.g. 'Portuguese (Brazil)')
  language_offered boolean not null default false, -- has she offered to switch to their native language?
  created_at timestamptz not null default now()
);

create table if not exists public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.assistant_threads(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'dm' check (kind in ('dm', 'story_mention', 'story_reply', 'note')),
  text text not null default '',
  ig_message_id text unique,
  status text not null default 'received' check (status in ('received', 'draft', 'sent', 'rejected', 'failed')),
  needs_human boolean not null default false,
  reason text,
  translation text,  -- English translation for the team when the message isn't in English
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create index if not exists assistant_messages_thread on public.assistant_messages (thread_id, created_at);
create index if not exists assistant_messages_drafts on public.assistant_messages (status) where status = 'draft';

create table if not exists public.assistant_mentions (
  id uuid primary key default gen_random_uuid(),
  ig_media_id text not null unique,
  kind text not null check (kind in ('post', 'story')),
  ig_user_id text,
  username text,
  permalink text,
  caption text,
  media_url text,
  reply_text text,
  reply_status text not null default 'draft' check (reply_status in ('draft', 'sent', 'rejected', 'failed', 'skipped')),
  error text,
  reshared boolean not null default false,  -- resharing a Story is done by hand in Instagram
  received_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.assistant_stories (
  id uuid primary key default gen_random_uuid(),
  story_date date not null unique,
  title text not null,
  lines jsonb not null default '[]',  -- [{time, title, instructor, style_slug}]
  art_slug text,                      -- class artwork to use as the background
  image_path text,                    -- rendered image in the assistant-media bucket
  status text not null default 'draft' check (status in ('draft', 'published', 'rejected', 'failed', 'skipped')),
  ig_media_id text,
  error text,
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null
);

alter table public.assistant_settings enable row level security;
alter table public.assistant_threads enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_mentions enable row level security;
alter table public.assistant_stories enable row level security;

drop policy if exists assistant_settings_admin on public.assistant_settings;
create policy assistant_settings_admin on public.assistant_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists assistant_threads_admin on public.assistant_threads;
create policy assistant_threads_admin on public.assistant_threads for select to authenticated using (public.is_admin());
drop policy if exists assistant_messages_admin on public.assistant_messages;
create policy assistant_messages_admin on public.assistant_messages for select to authenticated using (public.is_admin());
drop policy if exists assistant_mentions_admin on public.assistant_mentions;
create policy assistant_mentions_admin on public.assistant_mentions for select to authenticated using (public.is_admin());
drop policy if exists assistant_stories_admin on public.assistant_stories;
create policy assistant_stories_admin on public.assistant_stories for select to authenticated using (public.is_admin());

grant select on public.assistant_threads, public.assistant_messages, public.assistant_mentions, public.assistant_stories to authenticated;
grant select, update on public.assistant_settings to authenticated;

-- Public bucket for Story images (Instagram fetches them by URL to publish).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assistant-media', 'assistant-media', true, 8 * 1024 * 1024, array['image/png', 'image/jpeg'])
on conflict (id) do update set public = true;
drop policy if exists assistant_media_admin on storage.objects;
create policy assistant_media_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'assistant-media' and public.is_admin());

-- What Thamires knows: studio facts, prices, classes and the next two weeks of the timetable.
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
    'notes', (select notes from public.assistant_settings));
$$;

-- Admin decisions on drafts (the edge function does the actual sending).
create or replace function public.assistant_reject(p_message_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  update public.assistant_messages set status = 'rejected', decided_by = auth.uid() where id = p_message_id and status = 'draft';
  if not found then perform public._fail('not_found'); end if;
end;
$$;

create or replace function public.assistant_mark_reshared(p_mention_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  update public.assistant_mentions set reshared = p_done where id = p_mention_id;
end;
$$;

-- Tell admins something is waiting (email + phone, one per draft).
create or replace function public._assistant_notify(p_kind text, p_payload jsonb, p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select p.id, p_kind, p_payload, p_key || ':' || p.id from public.profiles p where p.role = 'admin'
  on conflict (dedupe_key) do nothing;
$$;

revoke all on function public.assistant_knowledge(), public._assistant_notify(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.assistant_knowledge(), public._assistant_notify(text, jsonb, text) to service_role;
revoke all on function public.assistant_reject(uuid), public.assistant_mark_reshared(uuid, boolean) from public, anon;
grant execute on function public.assistant_reject(uuid), public.assistant_mark_reshared(uuid, boolean) to authenticated;

-- Every hour: prepare today's Story once it's past the chosen hour (the function decides).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule('drop-thamires-story') where exists (select 1 from cron.job where jobname = 'drop-thamires-story');
    perform cron.schedule('drop-thamires-story', '7 * * * *', $job$
      select net.http_post(
        url := 'https://plskvdfcjdxkfiznguzo.supabase.co/functions/v1/thamires',
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
      )
    $job$);
  end if;
end $$;
