-- Drop Studios — instructors (and admins) can book any class for themselves,
-- free of charge. The booking takes a normal spot (capacity still applies),
-- uses no membership and no payment, and shows as "Instructor" on class lists.

alter table public.bookings add column staff_free boolean not null default false;

create or replace function public.staff_book_self(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.class_sessions;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_staff() then perform public._fail('forbidden'); end if;
  perform public._require_staff_dob();

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;
  if s.status <> 'scheduled' then perform public._fail('session_cancelled'); end if;
  if s.starts_at <= now() then perform public._fail('session_started'); end if;
  if exists (select 1 from public.bookings where user_id = auth.uid() and session_id = s.id
             and status in ('booked', 'attended', 'no_show', 'pending_payment')) then
    perform public._fail('already_booked');
  end if;
  if s.booked_count >= s.capacity then perform public._fail('session_full'); end if;

  insert into public.bookings (user_id, session_id, status, staff_free)
  values (auth.uid(), s.id, 'booked', true)
  returning id into v_id;
  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;
  perform public._audit('staff_free_booking', 'booking', v_id::text, jsonb_build_object('session_id', s.id));
  return jsonb_build_object('booking_id', v_id, 'status', 'booked');
end;
$$;

-- Class lists label free staff bookings as "staff".
create or replace function public.staff_roster(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform public._require_staff_dob();
  v := public._staff_roster(p_session_id);
  return jsonb_set(v, '{bookings}', coalesce((
    select jsonb_agg(case when b.staff_free then x.e || '{"kind": "staff"}'::jsonb else x.e end order by x.ord)
    from jsonb_array_elements(v -> 'bookings') with ordinality x(e, ord)
    left join public.bookings b on b.id = (x.e ->> 'booking_id')::uuid
  ), '[]'::jsonb));
end;
$$;

revoke execute on function public.staff_book_self(uuid) from public, anon;
grant execute on function public.staff_book_self(uuid) to authenticated;
grant select (staff_free) on public.bookings to authenticated;
