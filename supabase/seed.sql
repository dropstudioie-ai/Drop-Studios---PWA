-- LOCAL DEVELOPMENT ONLY — demo timetable so the app has something to show.
-- `supabase db reset` runs this file; `supabase db push` (production) does NOT.
-- Replace with the real Drop Studios timetable in Admin → Timetable.

insert into public.instructors (full_name) values
  ('Demo Instructor A'), ('Demo Instructor B'), ('Demo Instructor C');

with s as (select id, slug from public.dance_styles),
     i as (select id, row_number() over (order by full_name) n from public.instructors)
insert into public.class_templates (title, style_id, instructor_id, weekday, start_time, duration_minutes, capacity, level, valid_from)
select t.title, (select id from s where slug = t.style), (select id from i where n = t.instr), t.wd, t.st::time, 60, 20, t.lvl, current_date - 7
from (values
  ('FitDance',            'fitdance',   1, 1, '18:00', 'All levels'),
  ('Heels Beginners',     'heels',      2, 1, '19:15', 'Beginners'),
  ('Hip Hop Foundations', 'hip-hop',    3, 2, '18:30', 'Beginners'),
  ('Commercial',          'commercial', 1, 2, '19:45', 'Intermediate'),
  ('Reggaeton',           'reggaeton',  2, 3, '18:00', 'All levels'),
  ('Jazz Funk',           'jazz-funk',  3, 3, '19:15', 'All levels'),
  ('Heels Intermediate',  'heels',      2, 4, '19:00', 'Intermediate'),
  ('FitDance',            'fitdance',   1, 5, '18:00', 'All levels'),
  ('Commercial Choreo',   'commercial', 1, 6, '11:00', 'All levels'),
  ('Hip Hop',             'hip-hop',    3, 6, '12:15', 'All levels'),
  ('Reggaeton',           'reggaeton',  2, 7, '12:00', 'All levels')
) as t(title, style, instr, wd, st, lvl);

select public.generate_sessions(current_date - 7, current_date + 35);
