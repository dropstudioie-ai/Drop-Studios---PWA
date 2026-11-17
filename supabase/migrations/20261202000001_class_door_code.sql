-- Members see the front door code once they're booked into a class (from booking until the class ends).
-- The code itself stays in rental_private (admin-only); this only returns it to someone with a live booking,
-- the class's instructor, or an admin.
create or replace function public.class_access(p_session_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select (select access_code from public.rental_private limit 1)
  where exists (select 1 from public.class_sessions s where s.id = p_session_id and s.status = 'scheduled' and s.ends_at > now())
    and (
      exists (select 1 from public.bookings b where b.session_id = p_session_id and b.user_id = auth.uid() and b.status in ('booked', 'attended'))
      or exists (select 1 from public.class_sessions s join public.instructors i on i.id = s.instructor_id where s.id = p_session_id and i.profile_id = auth.uid())
      or public.is_admin()
    );
$$;
revoke all on function public.class_access(uuid) from public, anon;
grant execute on function public.class_access(uuid) to authenticated;
