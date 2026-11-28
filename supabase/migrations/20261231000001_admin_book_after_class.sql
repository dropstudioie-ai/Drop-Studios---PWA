-- Admins can book a member into a class after it has finished (e.g. they came
-- but weren't booked or checked in). Instructors are still limited to "until
-- the class ends".
--
-- * The booking is recorded straight away as Attended (it's a record of a class
--   that already happened), so no event-details email or reminder goes out.
-- * The membership is judged as it stood when the class started: a pack that
--   has expired since then can still cover it, but a class after the pack's
--   expiry, or during a pause, is still refused.
-- * A finished class isn't held to its capacity: the member was in the room.

create or replace function public._membership_issue(m memberships, s class_sessions)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  pur public.membership_purchases;
  v_expiry timestamptz;
  -- For a class in the past (admin booking after the class), judge the pack as of the class.
  v_at timestamptz := least(now(), s.starts_at);
begin
  select * into pur from public.membership_purchases where id = m.purchase_id;

  if m.admin_status = 'cancelled' then return 'membership_cancelled'; end if;
  if m.activated_at is not null and m.expires_at <= v_at then return 'membership_expired'; end if;
  if m.classes_remaining <= 0 then return 'no_classes_left'; end if;

  -- A pack activated by its first booking would start now.
  v_expiry := coalesce(m.expires_at, public.compute_expiry(now(), pur.validity_days, 0));
  if s.starts_at >= v_expiry then return 'class_after_expiry'; end if;

  if public._is_paused_on(m.id, public._local_date(v_at)) then return 'membership_paused'; end if;
  if public._is_paused_on(m.id, public._local_date(s.starts_at)) then return 'class_in_pause'; end if;

  if s.is_special then return 'special_event'; end if;
  -- A credit from a cancelled Drop In is worth what was paid: only classes at that price or less.
  if m.max_class_price_cents is not null
     and coalesce((select drop_in_price_cents from public.dance_styles where id = s.style_id), 0) > m.max_class_price_cents
  then return 'class_price_above_credit'; end if;
  if not (s.style_id = any (pur.allowed_style_ids)) then return 'style_not_included'; end if;

  if s.template_id = any (pur.excluded_template_ids)
     or exists (select 1 from public.plan_exclusions e where e.plan_id = pur.plan_id and e.session_id = s.id)
     -- Exclusions of recurring classes added after purchase only apply to
     -- classes that did not exist at purchase time (terms are preserved).
     or exists (
       select 1 from public.plan_exclusions e
       join public.class_templates t on t.id = e.template_id
       where e.plan_id = pur.plan_id and e.template_id = s.template_id
         and t.created_at > pur.purchased_at
     )
  then return 'class_excluded'; end if;

  return null;
end;
$function$;

create or replace function public._book_for(
  p_user uuid,
  p_session_id uuid,
  p_membership_id uuid,
  p_actor uuid,
  p_by_staff boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := p_user;
  s public.class_sessions;
  m public.memberships;
  cand public.memberships;
  v_issue text;
  v_live_issue text;
  v_dead_issue text;
  v_booking_id uuid;
  v_remaining int;
  v_after boolean := false;   -- admin recording a class that has already finished
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;

  if p_by_staff then
    -- Staff add members at the door: no booking window, open until the class ends.
    -- Admins can also add them after the class has finished.
    if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;
    v_after := s.ends_at <= now();
    if v_after and not public.is_admin() then perform public._fail('session_started'); end if;
    if exists (
      select 1 from public.bookings where user_id = v_uid and session_id = s.id
        and status in ('booked', 'attended', 'no_show', 'pending_payment')
    ) then perform public._fail('already_booked'); end if;
    if not v_after and s.booked_count >= s.capacity then perform public._fail('session_full'); end if;
  else
    v_issue := public._session_issue(s, v_uid);
    if v_issue is not null then perform public._fail(v_issue); end if;
  end if;

  if p_membership_id is not null then
    select * into m from public.memberships
    where id = p_membership_id and user_id = v_uid for update;
    if not found then perform public._fail('membership_not_found'); end if;
    v_issue := public._membership_issue(m, s);
    if v_issue is not null then perform public._fail(v_issue); end if;
  else
    -- Use the pack that expires soonest; packs awaiting activation go last.
    for cand in
      select * from public.memberships
      where user_id = v_uid
      order by (activated_at is null), expires_at, created_at
      for update
    loop
      v_issue := public._membership_issue(cand, s);
      if v_issue is null then
        m := cand;
        exit;
      elsif v_issue in ('membership_expired', 'no_classes_left', 'membership_cancelled') then
        v_dead_issue := coalesce(v_dead_issue, v_issue);
      else
        v_live_issue := coalesce(v_live_issue, v_issue);
      end if;
    end loop;
    if m.id is null then
      perform public._fail(coalesce(v_live_issue, v_dead_issue, 'no_membership'));
    end if;
  end if;

  if m.activated_at is null then
    update public.memberships mm
    set activated_at = now(),
        base_expires_at = public.compute_expiry(now(), pu.validity_days, 0),
        expires_at = public.compute_expiry(now(), pu.validity_days, 0)
    from public.membership_purchases pu
    where mm.id = m.id and pu.id = mm.purchase_id;
  end if;

  begin
    if v_after then
      insert into public.bookings (user_id, session_id, membership_id, status, attendance_marked_at, attendance_marked_by)
      values (v_uid, s.id, m.id, 'attended', now(), p_actor)
      returning id into v_booking_id;
    else
      insert into public.bookings (user_id, session_id, membership_id)
      values (v_uid, s.id, m.id)
      returning id into v_booking_id;
    end if;
  exception when unique_violation then
    perform public._fail('already_booked');
  end;

  update public.memberships set classes_remaining = classes_remaining - 1
  where id = m.id
  returning classes_remaining into v_remaining;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id)
  values (m.id, v_uid, -1, v_remaining, 'booking', v_booking_id, p_actor);

  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'membership_id', m.id,
    'classes_remaining', v_remaining,
    'after_class', v_after
  );
end;
$$;
