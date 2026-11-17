-- Thamires posts on her own: today's class Stories at 7:00, and next week's timetable on
-- Friday, Saturday and Sunday at 18:00. Stories are drawn on the server from assets in the
-- assistant-media bucket (class artwork as JPEG, fonts, the drawing engine).

alter table public.assistant_settings
  add column if not exists story_auto_publish boolean not null default true,
  add column if not exists weekly_schedule boolean not null default true,
  add column if not exists weekly_hour int not null default 18 check (weekly_hour between 7 and 22),
  add column if not exists weekly_days int[] not null default '{5,6,0}';
alter table public.assistant_settings drop constraint if exists assistant_settings_story_hour_check;
alter table public.assistant_settings add constraint assistant_settings_story_hour_check check (story_hour between 5 and 20);
update public.assistant_settings set story_hour = 7;

create table if not exists public.assistant_weekly (
  id uuid primary key default gen_random_uuid(),
  post_date date not null unique,
  week_start date not null,
  status text not null default 'posting' check (status in ('posting', 'published', 'failed')),
  classes int,
  image_path text,
  ig_media_id text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.assistant_weekly enable row level security;
drop policy if exists assistant_weekly_admin on public.assistant_weekly;
create policy assistant_weekly_admin on public.assistant_weekly for select to authenticated using (public.is_admin());
grant select on public.assistant_weekly to authenticated;

update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'video/mp4', 'font/ttf', 'application/wasm']
where id = 'assistant-media';

-- Run at one minute past each hour, so 7:00 and 18:00 posts go out at 7:01 and 18:01.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.alter_job(jobid, schedule := '1 * * * *') from cron.job where jobname = 'drop-thamires-story'$q$;
  end if;
end $$;
