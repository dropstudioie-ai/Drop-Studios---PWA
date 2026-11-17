-- Thamires: promo Stories posted on a schedule (e.g. the app promo video followed by the gift card ad,
-- every 2 days for 6 weeks). The videos/images live in the assistant-media bucket.

update storage.buckets set file_size_limit = 50 * 1024 * 1024,
  allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4']
where id = 'assistant-media';

create table if not exists public.assistant_promos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  items jsonb not null,                        -- [{ "path": "promos/app.mp4", "kind": "video", "label": "App promo" }, ...] in posting order
  every_days int not null default 2 check (every_days between 1 and 30),
  post_hour int not null default 12 check (post_hour between 7 and 22),
  starts_on date,                              -- null = not scheduled yet
  ends_on date,
  enabled boolean not null default false,
  last_posted_on date,
  progress jsonb,                              -- { "date": "2026-11-20", "ids": [...] } while a run is part-way
  posts_done int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.assistant_promos enable row level security;
drop policy if exists assistant_promos_admin on public.assistant_promos;
create policy assistant_promos_admin on public.assistant_promos for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.assistant_promos to authenticated;

-- Admins can upload promo videos too.
drop policy if exists assistant_media_admin on storage.objects;
create policy assistant_media_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'assistant-media' and public.is_admin());
