-- Moving members from the old app, plus two retention emails.
--  * Plan invites by email: old-app members get their private plans (the 2026 FitDance members' price,
--    UNLIMITED) as soon as they create their account with the same email.
--  * "Old-app members' price": 5 classes (any style) for €50, one month, on sale to invited members until
--    31 December 2026; from 2027 they choose a standard plan.
--  * Pack ending: members whose one-off pack (e.g. Intro) ends in 5 days, or is used up, get a friendly
--    reminder to keep dancing (no offer).
--  * Win-back: members who haven't booked in 14 days get a "we miss you" email (at most once a month).
--    It starts on 15 December, once everyone has moved from the old app (until then they book there).

create table if not exists public.plan_invites (
  email text not null check (email = lower(btrim(email))),
  plan_id uuid not null references public.membership_plans(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  primary key (email, plan_id)
);
alter table public.plan_invites enable row level security;
drop policy if exists plan_invites_admin on public.plan_invites;
create policy plan_invites_admin on public.plan_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public._apply_plan_invites() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is not null then
    insert into public.plan_access (plan_id, user_id)
    select i.plan_id, new.id from public.plan_invites i where i.email = lower(btrim(new.email))
    on conflict do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_plan_invites on public.profiles;
create trigger profiles_plan_invites after insert or update of email on public.profiles
  for each row execute function public._apply_plan_invites();

create or replace function public._invites_to_access() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.plan_access (plan_id, user_id)
  select new.plan_id, p.id from public.profiles p where lower(p.email) = new.email
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists plan_invites_apply on public.plan_invites;
create trigger plan_invites_apply after insert on public.plan_invites
  for each row execute function public._invites_to_access();
revoke all on function public._apply_plan_invites(), public._invites_to_access() from public, anon, authenticated;

-- The 2026 members' price (a copy of Multi-Style: 5 classes, any style), one month, private.
insert into public.membership_plans (code, name, display_label, short_description, price_cents, currency, class_count, validity_days, style_access,
  all_styles, first_time_only, is_active, sort_order, billing_interval, commitment_months, credit_rollover, highlight, visibility)
select 'member-price-2026', 'Members’ price · 5 classes', 'Old-app members', 'For members moving from the old Drop app: 5 classes, any style, for €50 this month. Available until 31 December 2026.',
  5000, currency, 5, 30, style_access, all_styles, false, true, 25, 'one_off', null, false, null, 'private'
from public.membership_plans where code = 'multi-5'
on conflict (code) do nothing;

-- Off sale from 1 January 2027.
create or replace function public.plan_sale_jobs() returns void language sql security definer set search_path = public, pg_temp as $$
  update public.membership_plans set is_active = false
  where code = 'member-price-2026' and is_active and public._local_date(now()) >= date '2027-01-01';
$$;
revoke all on function public.plan_sale_jobs() from public, anon, authenticated;

alter table public.app_settings
  add column if not exists winback_days int not null default 14 check (winback_days between 7 and 90),
  add column if not exists winback_from date default date '2026-12-15',
  add column if not exists pack_ending_days int not null default 5 check (pack_ending_days between 1 and 14);

create or replace function public.retention_jobs() returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg public.app_settings := (select x from public.app_settings x limit 1);
  today date := public._local_date(now());
  n_pack int; n_back int := 0;
begin
  -- Pack ending: a one-off pack (not a monthly plan) that ends within N days or has no classes left,
  -- for members with nothing else running.
  with ending as (
    select m.* from public.memberships m
    where m.subscription_id is null and m.plan_name not in ('Class credit')
      and m.expires_at > now() and (m.expires_at <= now() + make_interval(days => cfg.pack_ending_days) or m.classes_remaining = 0)
      and not exists (select 1 from public.memberships o where o.user_id = m.user_id and o.id <> m.id and o.expires_at > m.expires_at and o.classes_remaining > 0)
      and not exists (select 1 from public.member_subscriptions s where s.user_id = m.user_id and s.status in ('active', 'past_due', 'cancel_scheduled'))
  )
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select e.user_id, 'pack_ending', jsonb_build_object('plan_name', e.plan_name, 'expires_at', e.expires_at, 'classes_remaining', e.classes_remaining),
    'pack_ending:' || e.id
  from ending e join public.profiles p on p.id = e.user_id and p.role = 'customer'
  on conflict (dedupe_key) do nothing;
  get diagnostics n_pack = row_count;

  -- Win-back: booked before, nothing in the last N days and nothing coming up. Once a month at most.
  if cfg.winback_from is not null and today >= cfg.winback_from then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select p.id, 'winback', jsonb_build_object('last_class', (select max(s.starts_at) from public.bookings b join public.class_sessions s on s.id = b.session_id
        where b.user_id = p.id and b.status in ('attended', 'booked'))),
      'winback:' || p.id || ':' || to_char(today, 'YYYY-MM')
    from public.profiles p
    where p.role = 'customer' and p.notify_email
      and exists (select 1 from public.bookings b where b.user_id = p.id and b.status in ('attended', 'booked'))
      and not exists (select 1 from public.bookings b join public.class_sessions s on s.id = b.session_id
        where b.user_id = p.id and b.status in ('attended', 'booked', 'pending_payment') and s.starts_at > now() - make_interval(days => cfg.winback_days))
    on conflict (dedupe_key) do nothing;
    get diagnostics n_back = row_count;
  end if;
  perform public.plan_sale_jobs();
  return jsonb_build_object('pack_ending', n_pack, 'winback', n_back);
end;
$$;
revoke all on function public.retention_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('drop-retention-jobs') from cron.job where jobname = 'drop-retention-jobs'$q$;
    execute $q$select cron.schedule('drop-retention-jobs', '17 10 * * *', 'select public.retention_jobs()')$q$;
  end if;
end $$;
