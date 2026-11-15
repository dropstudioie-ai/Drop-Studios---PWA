-- Thamires: replies to comments on Drop's posts, counts reactions to her messages, and keeps Story insights.

create table if not exists public.assistant_comments (
  id uuid primary key default gen_random_uuid(),
  ig_comment_id text not null unique,
  media_id text,
  parent_id text,                 -- set when the comment is itself a reply to another comment
  ig_user_id text,
  username text,
  text text not null default '',
  post_caption text,
  permalink text,
  reply_text text,
  reply_status text not null default 'draft' check (reply_status in ('draft', 'sent', 'rejected', 'failed', 'skipped')),
  reply_id text,
  needs_human boolean not null default false,
  out_of_ordinary boolean not null default false,
  reason text,
  topic text,
  translation text,
  error text,
  received_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null
);
create index if not exists assistant_comments_status on public.assistant_comments (reply_status, received_at desc);
alter table public.assistant_comments enable row level security;
drop policy if exists assistant_comments_admin on public.assistant_comments;
create policy assistant_comments_admin on public.assistant_comments for select to authenticated using (public.is_admin());
grant select on public.assistant_comments to authenticated;

alter table public.assistant_settings add column if not exists auto_comment_reply boolean not null default false;
alter table public.assistant_messages add column if not exists reaction text;          -- emoji someone reacted with to this message
alter table public.assistant_stories
  add column if not exists insights jsonb,             -- {reach, impressions, replies, taps_forward, taps_back, exits}
  add column if not exists insights_at timestamptz;
alter table public.assistant_guidance add column if not exists comment_id uuid references public.assistant_comments(id) on delete set null;
