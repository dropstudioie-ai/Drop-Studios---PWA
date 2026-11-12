-- Drop Studios — admins edit a dated class (time, length, instructor, title).
-- Everyone booked is told what changed. Bookings stay; members who can't make
-- the new time can cancel as usual (the class is returned if in time).
create or replace function public.admin_update_session(
  p_session_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_instructor_id uuid,
  p_title text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  v_old_instructor text;
  v_new_instructor text;
  v_time_changed boolean;
  v_teacher_changed boolean;
  v_title_changed boolean;
  v_count int := 0;
begin
  perform public._require_admin();
  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;
  if s.status <> 'scheduled' then perform public._fail('session_cancelled'); end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then perform public._fail('invalid_session_times'); end if;
  if coalesce(btrim(p_title), '') = '' then perform public._fail('title_required'); end if;

  v_time_changed := p_starts_at <> s.starts_at or p_ends_at <> s.ends_at;
  v_teacher_changed := p_instructor_id is distinct from s.instructor_id;
  v_title_changed := btrim(p_title) <> s.title;
  if not (v_time_changed or v_teacher_changed or v_title_changed) then
    return jsonb_build_object('ok', true, 'changed', false, 'notified', 0);
  end if;

  select full_name into v_old_instructor from public.instructors where id = s.instructor_id;
  select full_name into v_new_instructor from public.instructors where id = p_instructor_id;

  update public.class_sessions
  set starts_at = p_starts_at, ends_at = p_ends_at, instructor_id = p_instructor_id, title = btrim(p_title)
  where id = s.id;

  insert into public.notification_outbox (user_id, kind, payload)
  select b.user_id, 'class_changed', jsonb_build_object(
    'session_id', s.id,
    'title', btrim(p_title), 'old_title', s.title,
    'starts_at', p_starts_at, 'old_starts_at', s.starts_at, 'ends_at', p_ends_at,
    'time_changed', v_time_changed,
    'instructor', v_new_instructor, 'old_instructor', v_old_instructor, 'instructor_changed', v_teacher_changed,
    'note', nullif(btrim(coalesce(p_note, '')), ''))
  from public.bookings b
  where b.session_id = s.id and b.status = 'booked';
  get diagnostics v_count = row_count;

  perform public._audit('session_updated', 'class_session', s.id::text, jsonb_build_object(
    'old', jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'instructor_id', s.instructor_id, 'title', s.title),
    'new', jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at, 'instructor_id', p_instructor_id, 'title', btrim(p_title)),
    'notified', v_count, 'note', p_note));
  return jsonb_build_object('ok', true, 'changed', true, 'notified', v_count);
end;
$$;

revoke execute on function public.admin_update_session(uuid, timestamptz, timestamptz, uuid, text, text) from public, anon;
grant execute on function public.admin_update_session(uuid, timestamptz, timestamptz, uuid, text, text) to authenticated;
