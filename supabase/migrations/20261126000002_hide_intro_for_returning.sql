-- The Intro Pack (first-time-only plans) disappears for signed-in members who have already bought a plan.
-- Visitors who aren't signed in still see it; admins see every plan.

-- "Should first-time-only plans show to me?" (only ever about the caller, so safe for everyone to run).
create or replace function public._intro_visible_to_me()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is null or public.is_first_time_customer(auth.uid());
$$;
revoke all on function public._intro_visible_to_me() from public;
grant execute on function public._intro_visible_to_me() to anon, authenticated;

drop policy if exists plans_read on public.membership_plans;
create policy plans_read on public.membership_plans for select to anon, authenticated using (
  public.is_admin()
  or (is_active
      and (visibility = 'public'
           or exists (select 1 from public.plan_access a where a.plan_id = membership_plans.id and a.user_id = auth.uid()))
      and (not first_time_only or public._intro_visible_to_me())));
