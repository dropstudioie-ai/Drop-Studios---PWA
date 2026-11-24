-- Class lists show attendance (attended, no-shows, late cancels), for looking back at past classes.
create or replace function public._staff_sessions(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_admin boolean := public.is_admin();
begin
  if auth.uid() is null or not (v_admin or public.is_staff()) then perform public._fail('forbidden'); end if;
  if p_to - p_from > interval '62 days' then perform public._fail('invalid_date_range'); end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'template_id', s.template_id, 'title', s.title, 'style_id', s.style_id,
        'instructor_id', s.instructor_id, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'level', s.level, 'room', s.room, 'is_special', s.is_special,
        'ticket_price_cents', s.ticket_price_cents, 'status', s.status, 'cancel_reason', s.cancel_reason,
        'capacity', s.capacity, 'booked_count', s.booked_count,
        'attended', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'attended'),
        'no_shows', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'no_show'),
        'late_cancels', (select count(*) from public.bookings b where b.session_id = s.id and b.status = 'late_cancelled'),
        'availability', public._availability(s.capacity, s.booked_count),
        'birthdays', (select count(*) from public.bookings b join public.profiles p on p.id = b.user_id
                      where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show')
                        and public._birthday_on(p.date_of_birth, public._local_date(s.starts_at))),
        'new_members', (select count(*) from public.bookings b
                        where b.session_id = s.id and b.status in ('booked', 'attended', 'no_show')
                          and public._is_new_member(b.user_id, s.starts_at)),
        'style', (select jsonb_build_object('id', d.id, 'name', d.name, 'color', d.color, 'slug', d.slug)
                  from public.dance_styles d where d.id = s.style_id),
        'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name)
                       from public.instructors i where i.id = s.instructor_id)
      ) order by s.starts_at), '[]'::jsonb)
    from public.class_sessions s
    where s.starts_at >= p_from and s.starts_at < p_to
      and (v_admin or public.teaches_session(s.id))
  );
end;
$function$;
