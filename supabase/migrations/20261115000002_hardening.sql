-- Drop Studios — hardening before go-live.
-- 1. Instructors can't change an approved workshop's price (only admins, and only before tickets sell).
-- 2. Instructors can create at most 3 events in 24 hours (stops notification spam).
-- 3. Tables added for events only expose what the app uses.

create or replace function public.update_event(
  p_event_id uuid,
  p_title text,
  p_description text default null,
  p_dress_code text default null,
  p_decorations text default null,
  p_extras text default null,
  p_capacity int default null,
  p_price_cents int default null,
  p_member_price_cents int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events := public._manageable_event(p_event_id);
  s public.class_sessions;
  v_sold boolean := false;
begin
  if public._clean(p_title) is null then perform public._fail('title_required'); end if;

  if e.kind = 'workshop' then
    if p_capacity is null or p_capacity < 1 or p_capacity > 200 then perform public._fail('invalid_capacity'); end if;
    if p_price_cents is null or p_price_cents < 0 or (p_member_price_cents is not null and (p_member_price_cents < 0 or p_member_price_cents > p_price_cents)) then
      perform public._fail('invalid_price');
    end if;
    if e.session_id is not null then
      select * into s from public.class_sessions where id = e.session_id for update;
      if p_capacity < s.booked_count then perform public._fail('capacity_below_booked'); end if;
      v_sold := exists (select 1 from public.payments where session_id = s.id and status in ('pending', 'succeeded', 'refunded'));
      if (v_sold or not public.is_admin()) and (p_price_cents is distinct from s.ticket_price_cents or p_member_price_cents is distinct from s.member_ticket_price_cents) then
        -- Prices are fixed once tickets are sold; before that only an admin can change an approved workshop's price.
        perform public._fail(case when v_sold then 'price_locked' else 'price_change_needs_admin' end);
      end if;
      update public.class_sessions set title = btrim(p_title), capacity = p_capacity,
        ticket_price_cents = p_price_cents, member_ticket_price_cents = p_member_price_cents where id = s.id;
    end if;
  end if;

  update public.studio_events set
    title = btrim(p_title), description = public._clean(p_description), dress_code = public._clean(p_dress_code),
    decorations = public._clean(p_decorations), extras = public._clean(p_extras),
    capacity = case when kind = 'workshop' then p_capacity else capacity end,
    price_cents = case when kind = 'workshop' then p_price_cents else price_cents end,
    member_price_cents = case when kind = 'workshop' then p_member_price_cents else member_price_cents end
  where id = e.id;

  perform public._audit('event_updated', 'studio_event', e.id::text, jsonb_build_object('title', p_title));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public._event_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and (
    select count(*) from public.studio_events where created_by = new.created_by and created_at > now() - interval '24 hours'
  ) >= 3 then
    perform public._fail('too_many_events');
  end if;
  return new;
end;
$$;
drop trigger if exists studio_events_rate_limit on public.studio_events;
create trigger studio_events_rate_limit before insert on public.studio_events
  for each row execute function public._event_rate_limit();
revoke execute on function public._event_rate_limit() from public, anon, authenticated;

revoke all on public.studio_events from anon, authenticated;
grant select on public.studio_events to authenticated;
revoke all on public.important_dates from anon, authenticated;
grant select, insert, update, delete on public.important_dates to authenticated;  -- admins only, by row security
revoke execute on function public._pause_moves_billing(), public.guard_avatar_path(), public.guard_profile_dob() from public, anon, authenticated;
