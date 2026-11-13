-- Event artwork made in Drop Design: an approved poster image for a special class or workshop,
-- shown on the class in the app. Uploaded by the event's instructor or an admin.

alter table public.studio_events
  add column if not exists artwork_path text,
  add column if not exists artwork_updated_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-art', 'event-art', true, 8 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Can the signed-in user manage artwork for this event? (Its instructor, or an admin.)
create or replace function public._can_manage_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_admin() or exists (
    select 1 from public.studio_events e where e.id = p_event_id and e.instructor_id = public._my_instructor_id());
$$;

create or replace function public._event_id_from_path(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then return null;
end;
$$;

drop policy if exists event_art_insert on storage.objects;
create policy event_art_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'event-art' and public._can_manage_event(public._event_id_from_path(name)));
drop policy if exists event_art_update on storage.objects;
create policy event_art_update on storage.objects for update to authenticated
  using (bucket_id = 'event-art' and public._can_manage_event(public._event_id_from_path(name)));
drop policy if exists event_art_delete on storage.objects;
create policy event_art_delete on storage.objects for delete to authenticated
  using (bucket_id = 'event-art' and public._can_manage_event(public._event_id_from_path(name)));

create or replace function public.set_event_artwork(p_event_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  if not public._can_manage_event(p_event_id) then perform public._fail('forbidden'); end if;
  if p_path is not null and (split_part(p_path, '/', 1) <> p_event_id::text
     or not exists (select 1 from storage.objects o where o.bucket_id = 'event-art' and o.name = p_path)) then
    perform public._fail('artwork_not_uploaded');
  end if;
  select artwork_path into v_old from public.studio_events where id = p_event_id;
  if not found then perform public._fail('not_found'); end if;
  update public.studio_events set artwork_path = p_path, artwork_updated_at = now() where id = p_event_id;
  insert into public.audit_log (action, entity_type, entity_id, actor_id, details)
  values ('event_artwork_set', 'studio_event', p_event_id::text, auth.uid(), jsonb_build_object('path', p_path, 'previous', v_old));
end;
$$;

-- Timetable: include the artwork on the class's event.
create or replace function public.timetable(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_session_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'template_id', s.template_id, 'title', s.title,
      'style_id', s.style_id, 'instructor_id', s.instructor_id,
      'starts_at', s.starts_at, 'ends_at', s.ends_at, 'level', s.level, 'room', s.room,
      'is_special', s.is_special, 'ticket_price_cents', s.ticket_price_cents,
      'member_ticket_price_cents', s.member_ticket_price_cents,
      'status', s.status, 'cancel_reason', s.cancel_reason,
      'availability', public._availability(s.capacity, s.booked_count),
      'style', (select jsonb_build_object('id', d.id, 'name', d.name, 'color', d.color, 'slug', d.slug)
                from public.dance_styles d where d.id = s.style_id),
      'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name)
                     from public.instructors i where i.id = s.instructor_id),
      'event', (select jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
                  'dress_code', e.dress_code, 'artwork_path', e.artwork_path,
                  'emoji', (select emoji from public.important_dates where id = e.important_date_id))
                from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1)
    ) order by s.starts_at), '[]'::jsonb)
  from public.class_sessions s
  where (p_session_id is not null and s.id = p_session_id)
     or (p_session_id is null and s.starts_at >= p_from and s.starts_at < p_to
         and p_to - p_from <= interval '62 days');
$$;

revoke all on function public._can_manage_event(uuid), public._event_id_from_path(text) from public, anon;
grant execute on function public._can_manage_event(uuid), public._event_id_from_path(text) to authenticated;
revoke all on function public.set_event_artwork(uuid, text) from public, anon;
grant execute on function public.set_event_artwork(uuid, text) to authenticated;
grant execute on function public.timetable(timestamptz, timestamptz, uuid) to anon, authenticated;
