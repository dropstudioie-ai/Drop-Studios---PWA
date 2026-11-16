-- Private membership plans, visible and purchasable only by members the studio authorises,
-- and the UNLIMITED plan: unlimited classes, €150 a month, renews monthly for 3 months.

alter table public.membership_plans
  add column if not exists visibility text not null default 'public' check (visibility in ('public', 'private'));

create table if not exists public.plan_access (
  plan_id uuid not null references public.membership_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);
alter table public.plan_access enable row level security;
drop policy if exists plan_access_admin on public.plan_access;
create policy plan_access_admin on public.plan_access for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists plan_access_own on public.plan_access;
create policy plan_access_own on public.plan_access for select to authenticated using (user_id = auth.uid());
grant select on public.plan_access to authenticated;

-- Members only see public plans, plus private plans they are authorised for.
drop policy if exists plans_read on public.membership_plans;
create policy plans_read on public.membership_plans for select to anon, authenticated using (
  public.is_admin()
  or (is_active and (visibility = 'public'
      or exists (select 1 from public.plan_access a where a.plan_id = membership_plans.id and a.user_id = auth.uid()))));

create or replace function public._plan_snapshot(p_user_id uuid, p_plan_id uuid, p_style_id uuid, p_check_first_time boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  p public.membership_plans;
  v_allowed uuid[];
begin
  select * into p from public.membership_plans where id = p_plan_id and is_active;
  if not found then perform public._fail('plan_unavailable'); end if;

  -- Private plans (e.g. UNLIMITED) can only be bought by members the studio has authorised (admins can always sell them).
  if p.visibility = 'private' and not public.is_admin()
     and not exists (select 1 from public.plan_access a where a.plan_id = p.id and a.user_id = p_user_id) then
    perform public._fail('plan_unavailable');
  end if;

  if p_check_first_time and p.first_time_only and not public.is_first_time_customer(p_user_id) then
    perform public._fail('intro_not_eligible');
  end if;

  if p.all_styles then
    select coalesce(array_agg(id order by sort_order), '{}') into v_allowed
    from public.dance_styles where is_active;
  else
    select coalesce(array_agg(ds.id order by ds.sort_order), '{}') into v_allowed
    from public.plan_styles ps join public.dance_styles ds on ds.id = ps.style_id
    where ps.plan_id = p.id and ds.is_active;
  end if;

  if p.style_access = 'single' then
    if p_style_id is null then perform public._fail('style_required'); end if;
    if not (p_style_id = any (v_allowed)) then perform public._fail('style_not_eligible'); end if;
    v_allowed := array[p_style_id];
  else
    p_style_id := null;
  end if;

  return jsonb_build_object(
    'plan_id', p.id,
    'plan_code', p.code,
    'plan_name', p.name,
    'price_cents', p.price_cents,
    'currency', p.currency,
    'class_count', p.class_count,
    'validity_days', p.validity_days,
    'style_access', p.style_access,
    'selected_style_id', p_style_id,
    'allowed_style_ids', to_jsonb(v_allowed),
    'excluded_template_ids', coalesce((
      select jsonb_agg(template_id) from public.plan_exclusions
      where plan_id = p.id and template_id is not null
    ), '[]'),
    'first_time_only', p.first_time_only,
    'billing_interval', p.billing_interval,
    'commitment_months', p.commitment_months,
    'credit_rollover', p.credit_rollover
  );
end;
$fn$;

-- Thamires never mentions private plans.
create or replace function public.assistant_knowledge()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
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
      from public.membership_plans p where p.is_active and p.visibility = 'public'),
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
    'notes', (select notes from public.assistant_settings),
    'owner_guidance', (select coalesce(jsonb_agg(jsonb_build_object('question', g.question, 'answer', g.answer) order by g.answered_at desc), '[]')
      from (select question, answer, answered_at from public.assistant_guidance where status = 'answered' order by answered_at desc limit 60) g));
$fn$;
revoke all on function public.assistant_knowledge() from public, anon, authenticated;
grant execute on function public.assistant_knowledge() to service_role;

-- Admins choose who can see a private plan.
create or replace function public.admin_set_plan_access(p_plan_id uuid, p_user_id uuid, p_allow boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if not exists (select 1 from public.membership_plans where id = p_plan_id) then perform public._fail('plan_unavailable'); end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then perform public._fail('not_found'); end if;
  if p_allow then
    insert into public.plan_access (plan_id, user_id, granted_by) values (p_plan_id, p_user_id, auth.uid()) on conflict do nothing;
  else
    delete from public.plan_access where plan_id = p_plan_id and user_id = p_user_id;
  end if;
  perform public._audit(case when p_allow then 'plan_access_granted' else 'plan_access_removed' end, 'profile', p_user_id::text,
    jsonb_build_object('plan_id', p_plan_id));
end;
$$;
revoke all on function public.admin_set_plan_access(uuid, uuid, boolean) from public, anon;
grant execute on function public.admin_set_plan_access(uuid, uuid, boolean) to authenticated;

-- The UNLIMITED plan (999 classes a month = unlimited; shown as "Unlimited" in the app).
insert into public.membership_plans (code, name, display_label, short_description, price_cents, class_count, validity_days,
  style_access, all_styles, first_time_only, is_active, sort_order, billing_interval, commitment_months, credit_rollover, cta_label, visibility)
values ('unlimited', 'UNLIMITED', 'By invitation', 'Unlimited classes, every style, every month.', 15000, 999, 30,
  'multi', true, false, true, 90, 'monthly', 3, false, 'Choose UNLIMITED', 'private')
on conflict (code) do nothing;
