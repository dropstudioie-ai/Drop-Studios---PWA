-- Drop Studios — real weekly timetable, imported from the studio's Google
-- Calendars (BIG STUDIO / SMALL STUDIO) as scheduled for November 2026.
-- Room rentals and private sessions in those calendars are not classes and
-- were left out. Spots per class (20) are a default: adjust in Admin → Timetable.
-- Re-running is harmless: rows are only added when missing.

insert into public.dance_styles (name, slug, color, sort_order)
values ('K-Pop', 'k-pop', '#10B981', 70)
on conflict (slug) do nothing;

insert into public.instructors (full_name)
select v.name from (values ('Jorge dos Santos'), ('Ana Souto')) as v(name)
where not exists (select 1 from public.instructors i where i.full_name = v.name);

with t (title, style_slug, instructor, weekday, start_time, minutes, room, valid_until) as (
  values
    ('K-Pop',            'k-pop',      null,               1, time '18:00', 60, 'Small Studio', null::date),
    ('Jazz Funk',        'jazz-funk',  null,               1, time '19:00', 60, 'Small Studio', null),
    ('Heels',            'heels',      null,               1, time '20:00', 90, 'Small Studio', date '2026-12-14'),
    ('FitDance Special', 'fitdance',   'Jorge dos Santos', 2, time '18:30', 60, 'Big Studio',   null),
    ('Reggaeton',        'reggaeton',  null,               2, time '19:30', 60, 'Big Studio',   null),
    ('FitDance',         'fitdance',   'Jorge dos Santos', 3, time '18:30', 60, 'Small Studio', null),
    ('Hip Hop',          'hip-hop',    'Ana Souto',        3, time '19:30', 60, 'Big Studio',   null),
    ('FitDance',         'fitdance',   'Jorge dos Santos', 4, time '18:00', 60, 'Small Studio', null),
    ('Commercial',       'commercial', null,               4, time '19:00', 60, 'Small Studio', null),
    ('FitDance',         'fitdance',   'Jorge dos Santos', 6, time '12:30', 60, 'Small Studio', null),
    ('Commercial',       'commercial', null,               6, time '13:30', 60, 'Small Studio', null)
)
insert into public.class_templates
  (title, style_id, instructor_id, weekday, start_time, duration_minutes, capacity, room, valid_from, valid_until)
select t.title, s.id, i.id, t.weekday, t.start_time, t.minutes, 20, t.room, date '2026-10-26', t.valid_until
from t
join public.dance_styles s on s.slug = t.style_slug
left join public.instructors i on i.full_name = t.instructor
where not exists (
  select 1 from public.class_templates x
  where x.weekday = t.weekday and x.start_time = t.start_time and x.title = t.title
);

-- Publish the bookable timetable straight away (pg_cron keeps it topped up).
select public.generate_sessions(current_date, current_date + 35);
