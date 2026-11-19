-- A copy of the old app's records (exported 19 Nov 2026), kept for the move to the new app and for
-- reporting. Admins only. Members' personal details stay in the database, never in the code.
create table if not exists public.old_app_members (
  email text primary key,
  full_name text, phone text, birth_date date,
  membership text, plan text, price_cents int, payment_type text,
  next_payment_on date, status text, paused_from date, paused_to date,
  commenced_on date, end_on date, last_visit_at timestamp, total_visits int,
  migration_group text, migration_email_sent_at timestamptz,
  exported_on date not null default date '2026-11-19'
);
create table if not exists public.old_app_lost_members (
  email text not null, full_name text, phone text, membership text, plan text,
  commenced_on date, concluded_on date, status_at_conclusion text, cancellation_reason text,
  exported_on date not null default date '2026-11-19',
  primary key (email, concluded_on)
);
create table if not exists public.old_app_reports (
  name text primary key, period text, data jsonb not null, exported_on date not null default date '2026-11-19'
);
alter table public.old_app_members enable row level security;
alter table public.old_app_lost_members enable row level security;
alter table public.old_app_reports enable row level security;
drop policy if exists old_members_admin on public.old_app_members;
create policy old_members_admin on public.old_app_members for select to authenticated using (public.is_admin());
drop policy if exists old_lost_admin on public.old_app_lost_members;
create policy old_lost_admin on public.old_app_lost_members for select to authenticated using (public.is_admin());
drop policy if exists old_reports_admin on public.old_app_reports;
create policy old_reports_admin on public.old_app_reports for select to authenticated using (public.is_admin());
grant select on public.old_app_members, public.old_app_lost_members, public.old_app_reports to authenticated;
