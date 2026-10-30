-- Drop Studios — weekly timetable (confirmed by the studio, October 2026).
-- All classes run in the Ground Floor Studio, 30 spots each. Private sessions
-- and room rentals are not classes, aren't bookable with memberships and are
-- deliberately not part of the timetable.
-- Re-running is harmless: rows are only added when missing.

insert into public.dance_styles (name, slug, color, sort_order)
values ('Choreography', 'choreography', '#14B8A6', 70)
on conflict (slug) do nothing;

insert into public.instructors (full_name)
select v.name from (values
  ('João Zublin'), ('Jorginho'), ('Vini Martins'), ('Talita Lima'),
  ('Ana Souto'), ('Alex Oliveira'), ('Humberto')
) as v(name)
where not exists (select 1 from public.instructors i where i.full_name = v.name);

with t (title, style_slug, instructor, weekday, start_time, minutes, valid_until) as (
  values
    ('Choreography',     'choreography', 'Vini Martins',  1, time '18:00', 60, null::date),
    ('Jazz Funk',        'jazz-funk',    'Vini Martins',  1, time '19:00', 60, null),
    ('Heels',            'heels',        'Talita Lima',   1, time '20:00', 90, date '2026-12-14'),
    ('FitDance Special', 'fitdance',     'João Zublin',   2, time '18:30', 60, null),
    ('Reggaeton',        'reggaeton',    'Humberto',      2, time '19:30', 60, null),
    ('FitDance',         'fitdance',     'Jorginho',      3, time '18:30', 60, null),
    ('Hip Hop',          'hip-hop',      'Ana Souto',     3, time '19:30', 60, null),
    ('FitDance',         'fitdance',     'João Zublin',   4, time '18:30', 60, null),
    ('Commercial',       'commercial',   'Alex Oliveira', 4, time '19:30', 60, null),
    ('FitDance',         'fitdance',     'João Zublin',   6, time '12:30', 60, null),
    ('Commercial',       'commercial',   'Alex Oliveira', 6, time '13:30', 60, null)
)
insert into public.class_templates
  (title, style_id, instructor_id, weekday, start_time, duration_minutes, capacity, room, valid_from, valid_until)
select t.title, s.id, i.id, t.weekday, t.start_time, t.minutes, 30, 'Ground Floor Studio', date '2026-10-26', t.valid_until
from t
join public.dance_styles s on s.slug = t.style_slug
join public.instructors i on i.full_name = t.instructor
where not exists (
  select 1 from public.class_templates x
  where x.weekday = t.weekday and x.start_time = t.start_time and x.title = t.title
);

-- Publish the bookable timetable straight away (pg_cron keeps it topped up).
select public.generate_sessions(current_date, current_date + 35);
