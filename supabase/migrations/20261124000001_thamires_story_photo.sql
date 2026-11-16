-- Thamires' daily Story: the photo can be changed (or uploaded) by an admin before publishing.
alter table public.assistant_stories add column if not exists photo_url text;

create or replace function public.assistant_set_story_photo(p_story_id uuid, p_photo_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if p_photo_url is not null and not (p_photo_url ~ '^/(classes|studio)/[a-z0-9-]+\.webp$' or p_photo_url like 'https://plskvdfcjdxkfiznguzo.supabase.co/storage/v1/object/public/assistant-media/%') then
    perform public._fail('invalid_photo');
  end if;
  update public.assistant_stories set photo_url = p_photo_url where id = p_story_id and status = 'draft';
  if not found then perform public._fail('not_found'); end if;
end;
$$;
revoke all on function public.assistant_set_story_photo(uuid, text) from public, anon;
grant execute on function public.assistant_set_story_photo(uuid, text) to authenticated;
