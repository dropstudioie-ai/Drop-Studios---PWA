-- Drop Studios — initial business configuration (editable later in Admin).
-- These are real products, not demo data. Prices are in euro cents.

insert into public.dance_styles (name, slug, color, sort_order) values
  ('FitDance',   'fitdance',   '#F97316', 10),
  ('Commercial', 'commercial', '#2563EB', 20),
  ('Hip Hop',    'hip-hop',    '#0EA5E9', 30),
  ('Heels',      'heels',      '#DB2777', 40),
  ('Jazz Funk',  'jazz-funk',  '#7C3AED', 50),
  ('Reggaeton',  'reggaeton',  '#EA580C', 60)
on conflict (slug) do nothing;

insert into public.membership_plans
  (code, name, display_label, short_description, price_cents, class_count, validity_days,
   style_access, all_styles, first_time_only, sort_order)
values
  ('intro-3',   '3-Class Intro',        'Intro Offer', 'For first-timers at Drop Studios.',      3500,  3, 21, 'multi',  true, true,  10),
  ('single-4',  '4-Class Single Style', null,          'Focus on one dance style.',              4900,  4, 28, 'single', true, false, 20),
  ('multi-5',   '5-Class Multi-Style',  null,          'Try different dance styles.',            5500,  5, 28, 'multi',  true, false, 30),
  ('multi-8',   '8-Class Multi-Style',  null,          'For regular dancers.',                   7900,  8, 28, 'multi',  true, false, 40),
  ('multi-12',  '12-Class Multi-Style', null,          'More classes, more flexibility.',        9900, 12, 56, 'multi',  true, false, 50)
on conflict (code) do nothing;

-- Scheduled jobs (Supabase hosted projects ship pg_cron). Skipped where the
-- extension is unavailable (e.g. plain Postgres in CI).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Keep 5 weeks of classes generated ahead of the 3-week booking window.
    perform cron.schedule('drop-generate-sessions', '15 2 * * *',
      $job$select public.generate_sessions(current_date, current_date + 35)$job$);
    perform cron.schedule('drop-expiry-reminders', '0 9 * * *',
      $job$select public.queue_expiry_reminders()$job$);
  end if;
end;
$$;
