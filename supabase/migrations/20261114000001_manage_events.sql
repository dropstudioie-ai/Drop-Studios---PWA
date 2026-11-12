-- Drop Studios — the instructor who organised an event, and admins, can
-- change it, move it and cancel it.
--
-- * update_event: name, message, what to wear, decorations, snacks; for
--   workshops also places (never below the people booked) and prices (only
--   while no ticket has been bought).
-- * reschedule_event: a special class moves its theme to another of the
--   instructor's classes; a workshop moves to a new time the studio is free.
--   Everyone booked and everyone who was told about it gets the new date.
-- * cancel_event: now also cancels a published workshop (tickets are flagged
--   for a refund, like any cancelled class).
-- * Admins are told when an instructor moves or cancels something.

-- Studio clash check that can ignore the workshop's own class.
drop function if exists public._studio_clash(timestamptz, timestamptz, uuid);
create function public._studio_clash(p_from timestamptz, p_to timestamptz, p_ignore_event uuid default null, p_ignore_session uuid default null)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select s.title from public.class_sessions s
     where s.status = 'scheduled' and s.id is distinct from p_ignore_session and s.starts_at < p_to and s.ends_at > p_from
     order by s.starts_at limit 1),
    (select e.title from public.studio_events e
     where e.kind = 'workshop' and e.status = 'pending' and e.id is distinct from p_ignore_event
       and e.starts_at < p_to and e.ends_at > p_from order by e.starts_at limit 1));
$$;
revoke execute on function public._studio_clash(timestamptz, timestamptz, uuid, uuid) from public, anon, authenticated;

-- Lock an event the caller may manage (its instructor or an admin), still to come.
create or replace function public._manageable_event(p_event_id uuid)
returns public.studio_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events;
  v_start timestamptz;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into e from public.studio_events where id = p_event_id for update;
  if not found then perform public._fail('event_not_found'); end if;
  if not (public.is_admin() or coalesce(e.instructor_id = public._my_instructor_id(), false)) then perform public._fail('forbidden'); end if;
  if e.status not in ('pending', 'published') then perform public._fail('event_not_pending'); end if;
  v_start := coalesce((select starts_at from public.class_sessions where id = e.session_id), e.starts_at);
  if v_start is not null and v_start <= now() then perform public._fail('session_started'); end if;
  return e;
end;
$$;
revoke execute on function public._manageable_event(uuid) from public, anon, authenticated;

-- Tell the admins (other than the person acting) what an instructor changed.
create or replace function public._tell_admins_event(e public.studio_events, p_action text, p_extra jsonb default '{}')
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.notification_outbox (user_id, kind, payload)
  select a.id, 'event_staff_change',
         coalesce(public._event_payload(e), jsonb_build_object('event_id', e.id, 'title', e.title, 'kind', e.kind, 'starts_at', e.starts_at,
           'instructor', (select full_name from public.instructors where id = e.instructor_id)))
         || jsonb_build_object('action', p_action) || p_extra
  from public.profiles a
  where a.role = 'admin' and a.id <> auth.uid() and not public.is_admin();
$$;
revoke execute on function public._tell_admins_event(public.studio_events, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Change the details
-- ---------------------------------------------------------------------------
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
      if v_sold and (p_price_cents is distinct from s.ticket_price_cents or p_member_price_cents is distinct from s.member_ticket_price_cents) then
        perform public._fail('price_locked');
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

-- ---------------------------------------------------------------------------
-- Move it
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_event(
  p_event_id uuid,
  p_session_id uuid default null,          -- special class: the new class
  p_starts_at timestamptz default null,    -- workshop: the new time
  p_ends_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events := public._manageable_event(p_event_id);
  old_s public.class_sessions;
  new_s public.class_sessions;
  v_old_start timestamptz;
  v_new_start timestamptz;
  v_n int := 0;
  v_m int := 0;
  v_payload jsonb;
begin
  if e.kind = 'special_class' then
    select * into old_s from public.class_sessions where id = e.session_id;
    select * into new_s from public.class_sessions where id = p_session_id for update;
    if not found then perform public._fail('session_not_found'); end if;
    if new_s.id = old_s.id then return jsonb_build_object('ok', true, 'notified', 0); end if;
    if new_s.instructor_id is distinct from e.instructor_id then perform public._fail('forbidden'); end if;
    if new_s.status <> 'scheduled' then perform public._fail('session_cancelled'); end if;
    if new_s.starts_at <= now() then perform public._fail('session_started'); end if;
    if new_s.is_special or exists (select 1 from public.studio_events where session_id = new_s.id and status in ('pending', 'published')) then
      perform public._fail('already_an_event');
    end if;
    v_old_start := old_s.starts_at;
    v_new_start := new_s.starts_at;
    update public.studio_events set session_id = new_s.id where id = e.id;
    select * into e from public.studio_events where id = e.id;
  else
    if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at - p_starts_at > interval '8 hours' then
      perform public._fail('invalid_session_times');
    end if;
    if p_starts_at < now() + interval '1 day' then perform public._fail('workshop_too_soon'); end if;
    if public._studio_clash(p_starts_at, p_ends_at, e.id, e.session_id) is not null then perform public._fail('studio_busy'); end if;
    v_old_start := e.starts_at;
    v_new_start := p_starts_at;
    update public.studio_events set starts_at = p_starts_at, ends_at = p_ends_at where id = e.id;
    if e.session_id is not null then
      select * into old_s from public.class_sessions where id = e.session_id for update;
      update public.class_sessions set starts_at = p_starts_at, ends_at = p_ends_at where id = old_s.id;
    end if;
    select * into e from public.studio_events where id = e.id;
  end if;

  if e.status = 'published' then
    v_payload := public._event_payload(e) || jsonb_build_object('old_starts_at', v_old_start, 'note', public._clean(p_note));

    -- Booked on the old date.
    insert into public.notification_outbox (user_id, kind, payload)
    select b.user_id, 'event_rescheduled', v_payload || jsonb_build_object('audience', case when e.kind = 'workshop' then 'ticket' else 'old_class' end,
             'old_class_title', old_s.title)
    from public.bookings b where b.session_id = old_s.id and b.status = 'booked';
    get diagnostics v_n = row_count;

    if e.kind = 'special_class' then
      -- Booked on the new class: the details.
      insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
      select b.user_id, 'event_details', public._event_payload(e), format('evdet:%s:%s:%s', e.id, new_s.id, b.user_id)
      from public.bookings b where b.session_id = new_s.id and b.status = 'booked'
      on conflict (dedupe_key) do nothing;
      get diagnostics v_m = row_count;
      v_n := v_n + v_m;
    end if;

    -- Everyone who was told about it.
    insert into public.notification_outbox (user_id, kind, payload)
    select a.user_id, 'event_rescheduled', v_payload || jsonb_build_object('audience', 'told')
    from public._event_audience(e.instructor_id) a
    where not exists (select 1 from public.bookings b where b.user_id = a.user_id and b.status = 'booked'
                        and b.session_id in (old_s.id, e.session_id));
    get diagnostics v_m = row_count;
    v_n := v_n + v_m;
  end if;

  perform public._tell_admins_event(e, 'rescheduled', jsonb_build_object('old_starts_at', v_old_start));
  perform public._audit('event_rescheduled', 'studio_event', e.id::text,
    jsonb_build_object('from', v_old_start, 'to', v_new_start, 'session_id', e.session_id, 'notified', v_n));
  return jsonb_build_object('ok', true, 'notified', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel it (published workshops too)
-- ---------------------------------------------------------------------------
create or replace function public.cancel_event(p_event_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  e public.studio_events := public._manageable_event(p_event_id);
  s public.class_sessions;
  b public.bookings;
  v_reason text := public._clean(p_reason);
  v_n int := 0;
begin
  if e.kind = 'workshop' and e.status = 'published' then
    if v_reason is null then perform public._fail('reason_required'); end if;
    select * into s from public.class_sessions where id = e.session_id for update;
    for b in select * from public.bookings where session_id = s.id and status in ('booked', 'pending_payment') loop
      perform public._cancel_booking(b.id, true, v_reason, true, 'session_cancelled_refund');
      if b.status = 'booked' then
        insert into public.notification_outbox (user_id, kind, payload)
        values (b.user_id, 'class_cancelled', jsonb_build_object(
          'title', s.title, 'starts_at', s.starts_at, 'reason', v_reason,
          'class_returned', b.membership_id is not null, 'ticket_refund', b.payment_id is not null));
        v_n := v_n + 1;
      end if;
    end loop;
    update public.class_sessions set status = 'cancelled', cancel_reason = v_reason where id = s.id; -- also ends the event
  else
    update public.studio_events set status = 'cancelled', admin_note = coalesce(v_reason, admin_note) where id = e.id;
    if e.kind = 'special_class' then
      insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
      select b2.user_id, 'event_cancelled', public._event_payload(e) || jsonb_build_object('reason', v_reason),
             format('evcan:%s:%s', e.id, b2.user_id)
      from public.bookings b2 where b2.session_id = e.session_id and b2.status = 'booked'
      on conflict (dedupe_key) do nothing;
      get diagnostics v_n = row_count;
    end if;
  end if;

  if e.status = 'published' then
    perform public._tell_admins_event(e, 'cancelled', jsonb_build_object('reason', v_reason, 'refunds', case when e.kind = 'workshop' then v_n end));
  end if;
  perform public._audit('event_cancelled', 'studio_event', e.id::text, jsonb_build_object('reason', v_reason, 'notified', v_n));
  return jsonb_build_object('ok', true, 'notified', v_n);
end;
$$;

revoke execute on function public.update_event(uuid, text, text, text, text, text, int, int, int),
  public.reschedule_event(uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.update_event(uuid, text, text, text, text, text, int, int, int),
  public.reschedule_event(uuid, uuid, timestamptz, timestamptz, text) to authenticated;
