-- Members bring friends to a class they booked, paying 1 class credit per friend from the same pack.
-- A booking can now have several friends; cancelling a friend (or the whole booking) gives the
-- credits back under the same rules as the member's own booking.
alter table public.session_guests drop constraint if exists session_guests_host_booking_id_key;
alter table public.session_guests add column if not exists membership_id uuid references public.memberships(id) on delete set null;
alter table public.session_guests add column if not exists credit_used boolean not null default false;
create index if not exists session_guests_host_idx on public.session_guests (host_booking_id);

/** Add friends to a booking, 1 credit each from the pack the booking used. */
create or replace function public._add_guests(p_booking_id uuid, p_names text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings; s public.class_sessions; m public.memberships;
  v_names text[]; v_name text; v_left int; v_issue text; n int;
begin
  select array_agg(x) into v_names from (select nullif(btrim(t), '') x from unnest(coalesce(p_names, '{}')) t) q where x is not null;
  n := coalesce(cardinality(v_names), 0);
  if n = 0 then perform public._fail('guest_name_required'); end if;
  if exists (select 1 from unnest(v_names) x where length(x) > 80) then perform public._fail('guest_name_required'); end if;
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or b.status <> 'booked' then perform public._fail('booking_not_active'); end if;
  select * into s from public.class_sessions where id = b.session_id for update;
  if s.status <> 'scheduled' then perform public._fail('session_cancelled'); end if;
  if s.starts_at <= now() then perform public._fail('session_started'); end if;
  if s.is_special then perform public._fail('special_event'); end if;
  if b.membership_id is null then perform public._fail('friends_need_class_credits'); end if;
  select * into m from public.memberships where id = b.membership_id for update;
  if m.classes_total >= 900 then perform public._fail('friends_need_class_credits'); end if;
  v_issue := public._membership_issue(m, s);
  if v_issue is not null and v_issue <> 'no_classes_left' then perform public._fail(v_issue); end if;
  if m.classes_remaining < n then perform public._fail('not_enough_credits_for_friends'); end if;
  if s.booked_count + n > s.capacity then perform public._fail('not_enough_spots_for_friend'); end if;

  foreach v_name in array v_names loop
    update public.memberships set classes_remaining = classes_remaining - 1 where id = m.id returning classes_remaining into v_left;
    insert into public.session_guests (session_id, host_booking_id, host_user_id, guest_name, membership_id, credit_used)
    values (s.id, b.id, b.user_id, v_name, m.id, true);
    insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id, reason)
    values (m.id, b.user_id, -1, v_left, 'booking', b.id, auth.uid(), 'Friend: ' || v_name);
  end loop;
  update public.class_sessions set booked_count = booked_count + n where id = s.id;
  perform public._audit('friends_added', 'booking', b.id::text, jsonb_build_object('friends', to_jsonb(v_names), 'membership_id', m.id));
  return jsonb_build_object('booking_id', b.id, 'friends', n, 'classes_remaining', v_left);
end;
$$;
revoke all on function public._add_guests(uuid, text[]) from public, anon, authenticated;

/** Member: book a class for themselves and their friends in one go. */
create or replace function public.book_class_with_guests(p_session_id uuid, p_membership_id uuid, p_guest_names text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  r := public.book_class(p_session_id, p_membership_id);
  if coalesce(cardinality(p_guest_names), 0) = 0 then return r; end if;
  return r || public._add_guests((r ->> 'booking_id')::uuid, p_guest_names);
end;
$$;

/** Member: bring more friends to a class they already booked. */
create or replace function public.add_guests(p_booking_id uuid, p_guest_names text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if not exists (select 1 from public.bookings where id = p_booking_id and user_id = auth.uid()) then perform public._fail('booking_not_found'); end if;
  return public._add_guests(p_booking_id, p_guest_names);
end;
$$;

/** Member: a friend can't come. Their credit comes back if it's early enough (same rule as a booking). */
create or replace function public.cancel_guest(p_guest_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg public.app_settings := public._settings();
  g public.session_guests; s public.class_sessions; v_late boolean; v_restore boolean; v_left int;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into g from public.session_guests where id = p_guest_id and host_user_id = auth.uid() for update;
  if not found then perform public._fail('guest_not_found'); end if;
  select * into s from public.class_sessions where id = g.session_id for update;
  if s.starts_at <= now() then perform public._fail('session_started'); end if;
  v_late := now() > s.starts_at - make_interval(mins => cfg.cancellation_cutoff_minutes);
  v_restore := g.credit_used and g.membership_id is not null and (not v_late or cfg.late_cancel_restores_class);
  delete from public.session_guests where id = g.id;
  update public.class_sessions set booked_count = greatest(booked_count - 1, 0) where id = s.id;
  if v_restore then
    update public.memberships set classes_remaining = classes_remaining + 1 where id = g.membership_id returning classes_remaining into v_left;
    insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id, reason)
    values (g.membership_id, g.host_user_id, 1, v_left, case when v_late then 'late_cancel_refund' else 'cancel_refund' end::public.ledger_kind, g.host_booking_id, auth.uid(), 'Friend cancelled: ' || g.guest_name);
  end if;
  -- A free friend (gift card) can be brought to another class.
  if not g.credit_used then
    update public.memberships set friend_pass = true, friend_pass_booking_id = null where friend_pass_booking_id = g.host_booking_id;
  end if;
  return jsonb_build_object('class_restored', v_restore, 'late', v_late);
end;
$$;

-- Cancelling a booking releases all its friends; their credits come back when the member's own class does.
create or replace function public._release_guest()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.session_guests; v_left int; n int := 0;
begin
  if old.status in ('booked', 'pending_payment') and new.status in ('cancelled', 'late_cancelled') then
    for g in delete from public.session_guests where host_booking_id = new.id returning * loop
      n := n + 1;
      if g.credit_used and g.membership_id is not null and new.class_restored then
        update public.memberships set classes_remaining = classes_remaining + 1 where id = g.membership_id returning classes_remaining into v_left;
        insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id, reason)
        values (g.membership_id, g.host_user_id, 1, v_left, case when new.status = 'late_cancelled' then 'late_cancel_refund' else 'cancel_refund' end::public.ledger_kind, new.id, auth.uid(), 'Friend: ' || g.guest_name);
      end if;
    end loop;
    if n > 0 then
      update public.class_sessions set booked_count = greatest(booked_count - n, 0) where id = new.session_id;
    end if;
  end if;
  return new;
end;
$$;

/** Member home: upcoming classes they're booked for, with their friends and what they can still add. */
create or replace function public.my_upcoming_bookings()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]') from (
    select jsonb_build_object(
      'booking_id', b.id, 'session_id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
      'style', st.name, 'color', st.color, 'instructor', ip.full_name,
      'is_ticket', b.payment_id is not null, 'is_special', s.is_special,
      'late', now() > s.starts_at - make_interval(mins => (select cancellation_cutoff_minutes from public._settings())),
      'cutoff_minutes', (select cancellation_cutoff_minutes from public._settings()),
      'late_restores', (select late_cancel_restores_class from public._settings()),
      'spots_left', greatest(s.capacity - s.booked_count, 0),
      'membership_id', m.id, 'plan_name', m.plan_name,
      'credits_left', case when m.classes_total >= 900 then null else m.classes_remaining end,
      'can_add_friends', m.id is not null and m.classes_total < 900 and not s.is_special and m.classes_remaining > 0
        and s.booked_count < s.capacity and coalesce(public._membership_issue(m, s), 'no_classes_left') = 'no_classes_left',
      'friends', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.guest_name, 'credit', g.credit_used) order by g.created_at)
                           from public.session_guests g where g.host_booking_id = b.id), '[]')
    ) x
    from public.bookings b
    join public.class_sessions s on s.id = b.session_id
    left join public.dance_styles st on st.id = s.style_id
    left join public.instructors ip on ip.id = s.instructor_id
    left join public.memberships m on m.id = b.membership_id
    where b.user_id = auth.uid() and b.status = 'booked' and s.status = 'scheduled' and s.ends_at > now()
  ) q;
$$;

revoke all on function public.book_class_with_guests(uuid, uuid, text[]), public.add_guests(uuid, text[]), public.cancel_guest(uuid), public.my_upcoming_bookings() from public, anon;
grant execute on function public.book_class_with_guests(uuid, uuid, text[]), public.add_guests(uuid, text[]), public.cancel_guest(uuid), public.my_upcoming_bookings() to authenticated;

CREATE OR REPLACE FUNCTION public._staff_roster(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s public.class_sessions;
  v_day date;
begin
  if auth.uid() is null or not public.can_staff_session(p_session_id) then perform public._fail('forbidden'); end if;
  select * into s from public.class_sessions where id = p_session_id;
  if not found then perform public._fail('session_not_found'); end if;
  v_day := public._local_date(s.starts_at);
  return jsonb_build_object(
    'session_id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
    'capacity', s.capacity, 'booked_count', s.booked_count, 'status', s.status,
    'bookings', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'booking_id', b.id, 'user_id', p.id, 'full_name', p.full_name, 'avatar_path', p.avatar_path,
          'email', p.email, 'phone', p.phone,
          'guest_name', (select string_agg(g.guest_name, ', ' order by g.created_at) from public.session_guests g where g.host_booking_id = b.id),
          'guest_count', (select count(*) from public.session_guests g where g.host_booking_id = b.id),
          'status', b.status, 'class_restored', b.class_restored, 'booked_at', b.booked_at,
          'kind', coalesce(pay.kind::text, 'membership'),
          'plan_name', m.plan_name,
          'is_new', public._is_new_member(p.id, s.starts_at),
          'is_birthday', public._birthday_on(p.date_of_birth, v_day),
          'turning', case when public._birthday_on(p.date_of_birth, v_day)
                          then date_part('year', age(v_day, p.date_of_birth))::int end
        ) order by (b.status = 'pending_payment'), p.full_name), '[]'::jsonb)
      from public.bookings b
      join public.profiles p on p.id = b.user_id
      left join public.memberships m on m.id = b.membership_id
      left join public.payments pay on pay.id = b.payment_id
      where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show', 'pending_payment')
    )
  );
end;
$function$;
