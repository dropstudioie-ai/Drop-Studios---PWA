-- Thamires' daily Stories: one Story per class (each with its own photo), published together in time order.
alter table public.assistant_stories
  add column if not exists photos jsonb not null default '{}',   -- class index -> chosen photo URL
  add column if not exists image_paths text[],                    -- rendered images, one per class
  add column if not exists ig_media_ids text[];                   -- published Story IDs, one per class

drop function if exists public.assistant_set_story_photo(uuid, text);
create or replace function public.assistant_set_story_photo(p_story_id uuid, p_photo_url text, p_index int default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if p_photo_url is not null and not (p_photo_url ~ '^/(classes|studio)/[a-z0-9-]+\.webp$' or p_photo_url like 'https://plskvdfcjdxkfiznguzo.supabase.co/storage/v1/object/public/assistant-media/%') then
    perform public._fail('invalid_photo');
  end if;
  if p_index is null then
    update public.assistant_stories set photo_url = p_photo_url where id = p_story_id and status = 'draft';
  elsif p_photo_url is null then
    update public.assistant_stories set photos = photos - p_index::text where id = p_story_id and status = 'draft';
  else
    update public.assistant_stories set photos = photos || jsonb_build_object(p_index::text, p_photo_url) where id = p_story_id and status = 'draft';
  end if;
  if not found then perform public._fail('not_found'); end if;
end;
$$;
revoke all on function public.assistant_set_story_photo(uuid, text, int) from public, anon;
grant execute on function public.assistant_set_story_photo(uuid, text, int) to authenticated;
