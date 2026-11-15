-- Thamires: a short log of what Meta sends (no message text), to check the Instagram connection.
create table if not exists public.assistant_webhook_log (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  signature_ok boolean not null,
  object text,
  fields text[],            -- e.g. {messages} or {comments}
  events int not null default 0
);
alter table public.assistant_webhook_log enable row level security;
drop policy if exists assistant_webhook_log_admin on public.assistant_webhook_log;
create policy assistant_webhook_log_admin on public.assistant_webhook_log for select to authenticated using (public.is_admin());
grant select on public.assistant_webhook_log to authenticated;
