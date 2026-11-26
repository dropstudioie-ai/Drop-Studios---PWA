-- Thamires on TikTok: Drop's connected account (server-only) and the videos sent to its drafts.
create table if not exists public.tiktok_connection (
  id boolean primary key default true check (id),
  open_id text not null,
  display_name text,
  avatar_url text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  scope text,
  connected_by uuid references public.profiles(id) on delete set null,
  connected_at timestamptz not null default now()
);
alter table public.tiktok_connection enable row level security;
revoke all on public.tiktok_connection from anon, authenticated;   -- tokens: server only

create table if not exists public.tiktok_login_states (
  state text primary key,
  created_by uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.tiktok_login_states enable row level security;
revoke all on public.tiktok_login_states from anon, authenticated;

create table if not exists public.tiktok_posts (
  id uuid primary key default gen_random_uuid(),
  path text not null,              -- file in the assistant-media bucket
  label text,
  caption text,                    -- suggested caption + hashtags, sent to the owner
  publish_id text,
  status text not null default 'sending' check (status in ('sending', 'in_drafts', 'failed')),
  error text,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.tiktok_posts enable row level security;
revoke all on public.tiktok_posts from anon, authenticated;
grant select on public.tiktok_posts to authenticated;
drop policy if exists tiktok_posts_admin on public.tiktok_posts;
create policy tiktok_posts_admin on public.tiktok_posts for select to authenticated using (public.is_admin());
