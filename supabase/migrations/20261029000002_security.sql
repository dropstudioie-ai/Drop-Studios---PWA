-- Drop Studios — access control
-- Customers may READ their own records. Every write to memberships, bookings,
-- payments or the ledger goes through SECURITY DEFINER functions (see 0003).

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'instructor'));
$$;

-- Generic audit trigger for admin-managed configuration tables.
create or replace function public.audit_config_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id text;
begin
  v_id := coalesce(
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id',
    (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'plan_id'
  );
  insert into public.audit_log (actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    v_id,
    jsonb_build_object(
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
    )
  );
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_settings', 'dance_styles', 'instructors', 'class_templates', 'class_sessions',
    'membership_plans', 'plan_styles', 'plan_exclusions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_config_change()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- class_sessions.booked_count changes on every booking; don't audit that noise.
drop trigger class_sessions_audit on public.class_sessions;
create trigger class_sessions_audit
  after insert or delete or update of title, style_id, instructor_id, starts_at, ends_at,
    capacity, level, room, is_special, status, cancel_reason
  on public.class_sessions
  for each row execute function public.audit_config_change();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.dance_styles enable row level security;
alter table public.instructors enable row level security;
alter table public.class_templates enable row level security;
alter table public.class_sessions enable row level security;
alter table public.membership_plans enable row level security;
alter table public.plan_styles enable row level security;
alter table public.plan_exclusions enable row level security;
alter table public.payments enable row level security;
alter table public.membership_purchases enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_pauses enable row level security;
alter table public.bookings enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.push_subscriptions enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

-- Public catalogue
grant select on public.app_settings, public.dance_styles, public.instructors,
  public.class_templates, public.class_sessions, public.membership_plans,
  public.plan_styles, public.plan_exclusions
  to anon, authenticated;
-- Admin-managed catalogue writes (RLS restricts to admins)
grant insert, update, delete on public.dance_styles, public.instructors,
  public.class_templates, public.membership_plans, public.plan_styles,
  public.plan_exclusions to authenticated;
grant update on public.app_settings to authenticated;
-- Sessions: admins may edit details, but booked_count is server-maintained.
grant insert, delete on public.class_sessions to authenticated;
grant update (title, style_id, instructor_id, starts_at, ends_at, capacity, level, room, is_special)
  on public.class_sessions to authenticated;

-- Customer-owned data: read only
grant select on public.profiles, public.payments, public.membership_purchases,
  public.memberships, public.membership_pauses, public.bookings,
  public.credit_transactions, public.audit_log, public.notification_outbox
  to authenticated;
-- Customers may edit only their own contact fields (role is not writable).
grant update (full_name, phone, marketing_opt_in) on public.profiles to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy settings_read on public.app_settings for select to anon, authenticated using (true);
create policy settings_admin on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Catalogue tables: everyone reads active rows, admins read and write all.
create policy styles_read on public.dance_styles for select to anon, authenticated
  using (is_active or public.is_admin());
create policy styles_admin on public.dance_styles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy instructors_read on public.instructors for select to anon, authenticated
  using (is_active or public.is_admin());
create policy instructors_admin on public.instructors for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy templates_read on public.class_templates for select to anon, authenticated
  using (is_active or public.is_admin());
create policy templates_admin on public.class_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy sessions_read on public.class_sessions for select to anon, authenticated using (true);
create policy sessions_admin on public.class_sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy plans_read on public.membership_plans for select to anon, authenticated
  using (is_active or public.is_admin());
create policy plans_admin on public.membership_plans for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy plan_styles_read on public.plan_styles for select to anon, authenticated using (true);
create policy plan_styles_admin on public.plan_styles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy plan_exclusions_read on public.plan_exclusions for select to anon, authenticated using (true);
create policy plan_exclusions_admin on public.plan_exclusions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Customer data: own rows, or admins.
create policy payments_own on public.payments for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy purchases_own on public.membership_purchases for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy memberships_own on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy pauses_own on public.membership_pauses for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy bookings_own on public.bookings for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
create policy ledger_own on public.credit_transactions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy audit_admin on public.audit_log for select to authenticated using (public.is_admin());
create policy outbox_admin on public.notification_outbox for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
