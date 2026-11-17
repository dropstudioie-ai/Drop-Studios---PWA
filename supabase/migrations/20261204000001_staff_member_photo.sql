-- Admins and instructors can add or change a member's profile photo (e.g. taken at reception or at class).
-- Staff may upload into any member's folder in the private "avatars" bucket and remove the old file;
-- the profile is updated through staff_set_member_photo, which checks the file belongs to that member.
drop policy if exists avatars_staff_insert on storage.objects;
create policy avatars_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and public.is_staff());
drop policy if exists avatars_staff_delete on storage.objects;
create policy avatars_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_staff());

create or replace function public.staff_set_member_photo(p_user_id uuid, p_path text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old text;
begin
  if not public.is_staff() then perform public._fail('forbidden'); end if;
  if p_path is null or split_part(p_path, '/', 1) <> p_user_id::text
     or not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
    perform public._fail('invalid_photo');
  end if;
  select avatar_path into v_old from public.profiles where id = p_user_id for update;
  if not found then perform public._fail('not_found'); end if;
  update public.profiles set avatar_path = p_path where id = p_user_id;
  perform public._audit('member_photo_set', 'profile', p_user_id::text, jsonb_build_object('by', auth.uid()));
  return v_old;
end;
$$;
revoke all on function public.staff_set_member_photo(uuid, text) from public, anon;
grant execute on function public.staff_set_member_photo(uuid, text) to authenticated;
