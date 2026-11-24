-- New sign-ups for Thamires' daily report and the weekly review: who joined, what they did (bought a membership,
-- a Drop In, were moved from the old app, or nothing yet) and their activity since (photo, bookings, attendance, last visit).
create or replace function public._signup_report(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with p as (
    select pr.id, pr.full_name, pr.created_at, pr.avatar_path is not null as photo, u.last_sign_in_at
    from public.profiles pr join auth.users u on u.id = pr.id
    where pr.role = 'customer' and pr.created_at >= p_from and pr.created_at < p_to
  ), x as (
    select p.*,
      exists (select 1 from public.old_app_members o where o.moved_user_id = p.id)
        or exists (select 1 from public.payments pa where pa.user_id = p.id and pa.provider = 'manual' and pa.amount_cents = 0 and pa.provider_payment_ref ilike 'Moved from old app%') as moved,
      (select coalesce(jsonb_agg(distinct coalesce(pa.plan_snapshot ->> 'plan_name', pa.kind::text)), '[]') from public.payments pa
        where pa.user_id = p.id and pa.status = 'succeeded' and pa.amount_cents > 0 and pa.kind::text in ('membership')) as plans,
      (select count(*) from public.payments pa where pa.user_id = p.id and pa.status = 'succeeded' and pa.kind = 'drop_in') as drop_ins,
      (select count(*) from public.payments pa where pa.user_id = p.id and pa.status = 'succeeded' and pa.kind::text in ('ticket', 'gift', 'rental')) as other_buys,
      (select coalesce(jsonb_agg(distinct pa.kind::text), '[]') from public.payments pa where pa.user_id = p.id and pa.status = 'succeeded' and pa.kind::text in ('ticket', 'gift', 'rental')) as other_kinds,
      (select count(*) from public.payments pa where pa.user_id = p.id and pa.status in ('pending', 'failed', 'cancelled')) as tried_to_pay,
      (select count(*) from public.bookings b where b.user_id = p.id and b.status in ('booked', 'attended', 'no_show', 'late_cancelled')) as bookings,
      (select count(*) from public.bookings b where b.user_id = p.id and b.status = 'attended') as attended,
      exists (select 1 from public.gift_cards g where g.redeemed_by = p.id) as gift
    from p
  ), y as (
    select x.*, case
      when moved then 'moved'
      when jsonb_array_length(plans) > 0 then 'membership'
      when drop_ins > 0 then 'drop_in'
      when gift then 'gift'
      when other_buys > 0 then 'other'
      else 'nothing' end as outcome
    from x
  )
  select jsonb_build_object(
    'count', (select count(*) from y),
    'membership', (select count(*) from y where outcome = 'membership'),
    'drop_in', (select count(*) from y where outcome = 'drop_in'),
    'moved', (select count(*) from y where outcome = 'moved'),
    'gift', (select count(*) from y where outcome = 'gift'),
    'other', (select count(*) from y where outcome = 'other'),
    'nothing', (select count(*) from y where outcome = 'nothing'),
    'with_photo', (select count(*) from y where photo),
    'booked', (select count(*) from y where bookings > 0),
    'attended', (select count(*) from y where attended > 0),
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', full_name, 'joined', created_at, 'outcome', outcome, 'plans', plans,
        'drop_ins', drop_ins, 'other_kinds', other_kinds, 'tried_to_pay', tried_to_pay, 'photo', photo, 'bookings', bookings, 'attended', attended, 'last_seen', last_sign_in_at)
        order by created_at) from y), '[]'::jsonb));
$$;
revoke all on function public._signup_report(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public._signup_report(timestamptz, timestamptz) to service_role;
