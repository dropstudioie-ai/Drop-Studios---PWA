-- Drop Studios — core schema
-- Customer-facing term is "classes"; internally a class allowance is tracked as
-- credits in memberships.classes_remaining plus an append-only ledger.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('customer', 'instructor', 'admin');
create type public.style_access as enum ('single', 'multi');
create type public.activation_policy as enum ('on_purchase', 'on_first_booking');
create type public.session_status as enum ('scheduled', 'cancelled');
create type public.booking_status as enum ('booked', 'cancelled', 'late_cancelled', 'attended', 'no_show');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded');
create type public.payment_provider as enum ('stripe', 'dev_test', 'manual');
create type public.membership_admin_status as enum ('valid', 'cancelled');
create type public.ledger_kind as enum (
  'grant_purchase', 'booking', 'cancel_refund', 'late_cancel_refund',
  'no_show_refund', 'session_cancelled_refund', 'admin_grant', 'admin_revoke'
);

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text,
  phone text,
  role public.user_role not null default 'customer',
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Studio-wide configuration (single row)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  timezone text not null default 'Europe/Dublin',
  booking_window_days int not null default 21 check (booking_window_days between 1 and 90),
  cancellation_cutoff_minutes int not null default 30 check (cancellation_cutoff_minutes >= 0),
  late_cancel_restores_class boolean not null default false,
  no_show_restores_class boolean not null default false,
  activation_policy public.activation_policy not null default 'on_purchase',
  max_pause_days_per_year int not null default 90 check (max_pause_days_per_year >= 0),
  min_pause_days int not null default 7 check (min_pause_days >= 1),
  expiry_reminder_days int not null default 5 check (expiry_reminder_days >= 0),
  expiry_reminders_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
insert into public.app_settings default values;

-- ---------------------------------------------------------------------------
-- Catalogue: styles, instructors, timetable
-- ---------------------------------------------------------------------------
create table public.dance_styles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  color text not null default '#2563EB',
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.instructors (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  bio text,
  photo_url text,
  instagram text,
  profile_id uuid unique references public.profiles (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Recurring weekly classes. weekday uses ISO numbering (1 = Monday).
-- start_time is local studio time (app_settings.timezone).
create table public.class_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  style_id uuid not null references public.dance_styles (id),
  instructor_id uuid references public.instructors (id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  duration_minutes int not null default 60 check (duration_minutes between 15 and 480),
  capacity int not null default 20 check (capacity > 0),
  level text,
  room text,
  is_special boolean not null default false,
  is_active boolean not null default true,
  valid_from date not null default current_date,
  valid_until date,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

-- Concrete dated classes customers book.
create table public.class_sessions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.class_templates (id) on delete set null,
  title text not null,
  style_id uuid not null references public.dance_styles (id),
  instructor_id uuid references public.instructors (id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity int not null check (capacity > 0),
  booked_count int not null default 0 check (booked_count >= 0),
  level text,
  room text,
  -- Workshops / premium events: not bookable with a membership pack.
  is_special boolean not null default false,
  status public.session_status not null default 'scheduled',
  cancel_reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (template_id, starts_at)
);
create index class_sessions_starts_at_idx on public.class_sessions (starts_at);

-- ---------------------------------------------------------------------------
-- Membership plans (configurable data; nothing priced in the UI)
-- ---------------------------------------------------------------------------
create table public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  display_label text,
  short_description text,
  price_cents int not null check (price_cents >= 0),
  currency char(3) not null default 'EUR',
  class_count int not null check (class_count > 0),
  validity_days int not null check (validity_days > 0),
  style_access public.style_access not null,
  -- true: every active style is eligible; false: only styles in plan_styles.
  all_styles boolean not null default true,
  first_time_only boolean not null default false,
  is_active boolean not null default true,
  -- Only shown when an administrator explicitly enables it.
  is_most_popular boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.plan_styles (
  plan_id uuid not null references public.membership_plans (id) on delete cascade,
  style_id uuid not null references public.dance_styles (id) on delete cascade,
  primary key (plan_id, style_id)
);

-- Classes excluded from a plan: either a whole recurring class or one session.
create table public.plan_exclusions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.membership_plans (id) on delete cascade,
  template_id uuid references public.class_templates (id) on delete cascade,
  session_id uuid references public.class_sessions (id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  check ((template_id is null) <> (session_id is null))
);
create unique index plan_exclusions_template_uq on public.plan_exclusions (plan_id, template_id) where template_id is not null;
create unique index plan_exclusions_session_uq on public.plan_exclusions (plan_id, session_id) where session_id is not null;

-- ---------------------------------------------------------------------------
-- Payments, purchases and membership instances
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  plan_id uuid not null references public.membership_plans (id),
  selected_style_id uuid references public.dance_styles (id),
  -- Plan terms captured when checkout started; used for fulfilment.
  plan_snapshot jsonb not null,
  amount_cents int not null check (amount_cents >= 0),
  currency char(3) not null default 'EUR',
  provider public.payment_provider not null,
  is_test boolean not null default false,
  status public.payment_status not null default 'pending',
  idempotency_key text not null,
  provider_session_id text unique,
  provider_payment_ref text,
  provider_event_id text unique,
  failure_reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);
create index payments_user_idx on public.payments (user_id);

-- Immutable record of what the customer bought and on which terms.
create table public.membership_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  payment_id uuid not null unique references public.payments (id),
  plan_id uuid not null references public.membership_plans (id),
  plan_code text not null,
  plan_name text not null,
  price_cents int not null,
  currency char(3) not null,
  class_count int not null,
  validity_days int not null,
  style_access public.style_access not null,
  allowed_style_ids uuid[] not null,
  excluded_template_ids uuid[] not null default '{}',
  selected_style_id uuid references public.dance_styles (id),
  first_time_only boolean not null,
  activation_policy public.activation_policy not null,
  cancellation_cutoff_minutes int not null,
  is_test boolean not null default false,
  purchased_at timestamptz not null default now()
);
create index membership_purchases_user_idx on public.membership_purchases (user_id);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null unique references public.membership_purchases (id),
  user_id uuid not null references public.profiles (id) on delete restrict,
  plan_name text not null,
  style_access public.style_access not null,
  selected_style_id uuid references public.dance_styles (id),
  classes_total int not null check (classes_total > 0),
  classes_remaining int not null check (classes_remaining >= 0),
  activated_at timestamptz,
  -- Expiry before any pauses; expires_at = base + paused days.
  base_expires_at timestamptz,
  expires_at timestamptz,
  admin_status public.membership_admin_status not null default 'valid',
  is_test boolean not null default false,
  last_expiry_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((activated_at is null) = (expires_at is null))
);
create index memberships_user_idx on public.memberships (user_id);

create table public.membership_pauses (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  starts_on date not null,
  ends_on date not null, -- inclusive
  original_ends_on date not null,
  is_cancelled boolean not null default false,
  reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index membership_pauses_membership_idx on public.membership_pauses (membership_id);

-- ---------------------------------------------------------------------------
-- Bookings and the class allowance ledger
-- ---------------------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  session_id uuid not null references public.class_sessions (id) on delete restrict,
  membership_id uuid references public.memberships (id),
  status public.booking_status not null default 'booked',
  class_restored boolean not null default false,
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text,
  attendance_marked_at timestamptz,
  attendance_marked_by uuid references public.profiles (id)
);
-- A customer can hold at most one live booking per class.
create unique index bookings_one_live_per_session
  on public.bookings (user_id, session_id)
  where status in ('booked', 'attended', 'no_show');
create index bookings_session_idx on public.bookings (session_id);
create index bookings_user_idx on public.bookings (user_id);

create table public.credit_transactions (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id),
  user_id uuid not null references public.profiles (id),
  delta int not null check (delta <> 0),
  balance_after int not null check (balance_after >= 0),
  kind public.ledger_kind not null,
  booking_id uuid references public.bookings (id),
  actor_id uuid references public.profiles (id),
  reason text,
  created_at timestamptz not null default now()
);
create index credit_transactions_membership_idx on public.credit_transactions (membership_id);

-- ---------------------------------------------------------------------------
-- Audit, notifications, push (future)
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Immutability guards
-- ---------------------------------------------------------------------------
create or replace function public.forbid_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'immutable_record' using detail = tg_table_name || ' rows cannot be modified';
end;
$$;

create trigger membership_purchases_immutable
  before update or delete on public.membership_purchases
  for each row execute function public.forbid_change();
create trigger credit_transactions_immutable
  before update or delete on public.credit_transactions
  for each row execute function public.forbid_change();
create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.forbid_change();

-- Paid payment terms cannot be rewritten.
create or replace function public.guard_payment_update()
returns trigger
language plpgsql
as $$
begin
  if old.amount_cents <> new.amount_cents
     or old.currency <> new.currency
     or old.plan_snapshot <> new.plan_snapshot
     or old.user_id <> new.user_id
     or old.is_test <> new.is_test then
    raise exception 'immutable_record' using detail = 'payment terms cannot be changed';
  end if;
  if old.status = 'succeeded' and new.status not in ('succeeded', 'refunded') then
    raise exception 'immutable_record' using detail = 'succeeded payment cannot be reverted';
  end if;
  return new;
end;
$$;
create trigger payments_guard before update on public.payments
  for each row execute function public.guard_payment_update();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger plans_touch before update on public.membership_plans for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function public.touch_updated_at();
