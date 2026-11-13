-- Class pages: one public page per style with real text (what it is, level,
-- what to wear, what to bring, first-class tips), the instructors and when it
-- runs. Instructors write their own bio and describe the classes they teach;
-- the studio's drafts fill the pages until they do.

alter table public.dance_styles
  add column if not exists level text,
  add column if not exists what_to_wear text,
  add column if not exists what_to_bring text,
  add column if not exists first_class text,
  add column if not exists details_confirmed boolean not null default false,
  add column if not exists details_updated_at timestamptz,
  add column if not exists details_updated_by uuid references public.profiles(id) on delete set null;

alter table public.instructors
  add column if not exists bio_confirmed boolean not null default false,
  add column if not exists bio_updated_at timestamptz;

-- Studio drafts (only where nothing has been written yet).
update public.dance_styles d set
  description = coalesce(d.description, v.description),
  level = coalesce(d.level, v.level),
  what_to_wear = coalesce(d.what_to_wear, v.wear),
  what_to_bring = coalesce(d.what_to_bring, v.bring),
  first_class = coalesce(d.first_class, v.first_class)
from (values
  ('fitdance',
   'A high-energy dance workout set to the hits you hear on the radio, from pop and funk to Latin and Afro beats. Your instructor leads simple, catchy moves you follow along with: no partner and no dance experience needed. You''ll sweat, laugh and leave buzzing. It''s a full-body cardio session that never feels like exercise.',
   'All levels. Perfect for complete beginners.',
   'Comfortable workout clothes and trainers with good support.',
   'A water bottle and a small towel.',
   'Arrive 10 minutes early to meet your instructor. Stand wherever you like: the moves are repeated, so you''ll pick them up as you go.'),
  ('commercial',
   'The style you see in music videos and on stage behind pop and R&B artists. Each class builds a short routine step by step, mixing hip hop, jazz and pop moves with lots of attitude. A great way to learn to pick up choreography, perform with confidence and have fun with your friends.',
   'All levels. Moves are broken down, with options to keep it simple or level up.',
   'Clothes you can move freely in and clean trainers.',
   'Water. Bring your phone if you''d like to film the routine at the end.',
   'Don''t worry about getting every step: watch, copy and enjoy. The routine is taught slowly before it''s done to the music.'),
  ('hip-hop',
   'Learn the grooves, bounces and foundations of hip hop, then put them together in a routine. Classes focus on musicality, style and feeling the beat, so you''ll improve your rhythm and confidence while dancing to the best hip hop and R&B tracks.',
   'All levels. Beginners welcome.',
   'Loose, comfortable clothes (joggers, baggy tops) and trainers.',
   'Water.',
   'Come with an open mind. The warm-up covers the basic grooves you''ll use in the routine.'),
  ('heels',
   'A sensual, confident dance class taught in heels. You''ll work on walks, floor work, posture and a routine that brings out your attitude and confidence. Everyone is welcome, whatever your shape, size or experience.',
   'All levels. You can start without heels and add them when you''re ready.',
   'Something you feel good in: leggings or shorts and a fitted top work well. Knee pads are recommended for floor work.',
   'Heels if you have them (a stable heel or boot is easiest to start with), knee pads and water. No heels yet? Dance in socks or trainers for your first class.',
   'It''s a 90-minute class with a gentle warm-up. Go at your own pace: nobody is judging, and you can sit out any part you''re not comfortable with.'),
  ('jazz-funk',
   'A mix of jazz technique and funky, powerful street dance with plenty of performance and attitude. Expect sharp moves, turns and expressive choreography to pop and R&B music. A fun way to build technique, control and stage presence.',
   'Beginner to intermediate. Some dance experience helps, but beginners are welcome.',
   'Fitted, comfortable clothes you can move in, and trainers or jazz shoes.',
   'Water.',
   'Focus on the energy, not on getting every step perfect. The routine is built up gradually through the class.'),
  ('reggaeton',
   'Dance to the hottest Latin urban hits. You''ll learn reggaeton moves, body isolations and a fun routine full of rhythm and flavour. A great workout and the perfect way to let loose after work.',
   'All levels. Perfect for beginners.',
   'Comfortable clothes and trainers.',
   'Water and a small towel.',
   'No partner needed. Just follow along and feel the music: the basic steps are repeated through the class.'),
  ('choreography',
   'Learn a full routine from start to finish, mixing styles to the music of the week. Classes focus on picking up choreography quickly, musicality, details and performance. A great next step if you already take other classes at Drop.',
   'Intermediate. Some dance experience recommended; motivated beginners are welcome to try.',
   'Clothes you can move freely in and trainers.',
   'Water. Bring your phone if you''d like to film the routine.',
   'The routine moves at a good pace, so arrive on time for the warm-up. It''s fine to mark the steps while you learn them.')
) as v(slug, description, level, wear, bring, first_class)
where d.slug = v.slug;

-- Draft bios (neutral, until each instructor writes their own).
update public.instructors i set bio = format('%s teaches %s at Drop Studios. Come along to a class to meet them!',
    split_part(i.full_name, ' ', 1), x.styles)
from (
  select t.instructor_id, string_agg(distinct s.name, ' and ') as styles
  from public.class_templates t join public.dance_styles s on s.id = t.style_id
  where t.is_active group by t.instructor_id
) x
where x.instructor_id = i.id and (i.bio is null or btrim(i.bio) = '');

-- The instructor row for the signed-in user.
create or replace function public._my_instructor_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.instructors where profile_id = auth.uid() and is_active limit 1;
$$;

create or replace function public._teaches_style(p_instructor uuid, p_style uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_templates t
                 where t.instructor_id = p_instructor and t.style_id = p_style and t.is_active);
$$;

-- What the signed-in instructor still has to write.
create or replace function public.my_teaching_profile()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_id uuid := public._my_instructor_id(); v jsonb;
begin
  if v_id is null then return null; end if;
  select jsonb_build_object(
    'instructor', (select jsonb_build_object('id', i.id, 'full_name', i.full_name, 'bio', i.bio, 'instagram', i.instagram,
                      'bio_confirmed', i.bio_confirmed) from public.instructors i where i.id = v_id),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description,
                      'level', s.level, 'what_to_wear', s.what_to_wear, 'what_to_bring', s.what_to_bring, 'first_class', s.first_class,
                      'details_confirmed', s.details_confirmed) order by s.sort_order)
                  from public.dance_styles s where s.is_active and public._teaches_style(v_id, s.id)), '[]'::jsonb))
  into v;
  v := v || jsonb_build_object('todo',
    not (v #>> '{instructor,bio_confirmed}')::boolean
    or exists (select 1 from jsonb_array_elements(v->'styles') e where not (e->>'details_confirmed')::boolean));
  return v;
end;
$$;

create or replace function public.save_my_bio(p_bio text, p_instagram text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid := public._my_instructor_id(); v_bio text := btrim(coalesce(p_bio, ''));
begin
  if v_id is null then perform public._fail('not_instructor'); end if;
  if length(v_bio) < 40 then perform public._fail('bio_too_short'); end if;
  if length(v_bio) > 1200 then perform public._fail('text_too_long'); end if;
  update public.instructors set bio = v_bio,
    instagram = nullif(regexp_replace(btrim(coalesce(p_instagram, '')), '^@', ''), ''),
    bio_confirmed = true, bio_updated_at = now()
  where id = v_id;
  insert into public.audit_log (action, entity_type, entity_id, actor_id, details)
  values ('instructor_bio_saved', 'instructor', v_id::text, auth.uid(), '{}'::jsonb);
end;
$$;

create or replace function public.save_style_details(p_style_id uuid, p_description text, p_level text,
  p_what_to_wear text, p_what_to_bring text, p_first_class text)
returns void language plpgsql security definer set search_path = public as $$
declare v_instr uuid := public._my_instructor_id(); v_admin boolean := public.is_admin();
begin
  if not v_admin and (v_instr is null or not public._teaches_style(v_instr, p_style_id)) then
    perform public._fail('not_your_class');
  end if;
  if length(btrim(coalesce(p_description, ''))) < 60 then perform public._fail('description_too_short'); end if;
  if length(p_description) > 1500 or length(coalesce(p_level, '')) > 200 or length(coalesce(p_what_to_wear, '')) > 400
     or length(coalesce(p_what_to_bring, '')) > 400 or length(coalesce(p_first_class, '')) > 600 then
    perform public._fail('text_too_long');
  end if;
  update public.dance_styles set
    description = btrim(p_description), level = nullif(btrim(coalesce(p_level, '')), ''),
    what_to_wear = nullif(btrim(coalesce(p_what_to_wear, '')), ''), what_to_bring = nullif(btrim(coalesce(p_what_to_bring, '')), ''),
    first_class = nullif(btrim(coalesce(p_first_class, '')), ''),
    -- Only an instructor who teaches it confirms the text; an admin edit keeps the request open.
    details_confirmed = details_confirmed or (v_instr is not null and public._teaches_style(v_instr, p_style_id)),
    details_updated_at = now(), details_updated_by = auth.uid()
  where id = p_style_id;
  if not found then perform public._fail('not_found'); end if;
  insert into public.audit_log (action, entity_type, entity_id, actor_id, details)
  values ('style_details_saved', 'dance_style', p_style_id::text, auth.uid(), '{}'::jsonb);
end;
$$;

-- Everything a public class page needs, in one call.
create or replace function public.class_page(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'style', jsonb_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'color', s.color, 'description', s.description,
      'level', s.level, 'what_to_wear', s.what_to_wear, 'what_to_bring', s.what_to_bring, 'first_class', s.first_class,
      'drop_in_price_cents', s.drop_in_price_cents),
    'instructors', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'full_name', i.full_name, 'bio', i.bio,
                      'instagram', i.instagram, 'photo_url', i.photo_url) order by i.full_name)
                  from public.instructors i
                  where i.is_active and exists (select 1 from public.class_templates t where t.instructor_id = i.id and t.style_id = s.id and t.is_active)), '[]'::jsonb),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('weekday', t.weekday, 'start_time', to_char(t.start_time, 'HH24:MI'),
                      'duration_minutes', t.duration_minutes, 'title', t.title, 'instructor', i.full_name, 'instructor_id', t.instructor_id)
                      order by (t.weekday + 6) % 7, t.start_time)
                  from public.class_templates t left join public.instructors i on i.id = t.instructor_id
                  where t.style_id = s.id and t.is_active and (t.valid_until is null or t.valid_until >= current_date)), '[]'::jsonb))
  from public.dance_styles s where s.slug = p_slug and s.is_active;
$$;

-- Ask every instructor (by email now, and in the app on their next sign-in) to write their bio and class details.
insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
select i.profile_id, 'instructor_profile_request',
       jsonb_build_object('styles', (select string_agg(distinct s.name, ', ') from public.class_templates t
                                       join public.dance_styles s on s.id = t.style_id where t.instructor_id = i.id and t.is_active)),
       'ipr:' || i.id
from public.instructors i
where i.is_active and i.profile_id is not null
  and exists (select 1 from public.class_templates t where t.instructor_id = i.id and t.is_active)
on conflict (dedupe_key) do nothing;

revoke all on function public._my_instructor_id(), public._teaches_style(uuid, uuid) from public, anon, authenticated;
revoke all on function public.my_teaching_profile(), public.save_my_bio(text, text),
  public.save_style_details(uuid, text, text, text, text, text), public.class_page(text) from public;
grant execute on function public.my_teaching_profile(), public.save_my_bio(text, text),
  public.save_style_details(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.class_page(text) to anon, authenticated;
