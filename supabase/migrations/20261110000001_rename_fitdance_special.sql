-- Tuesday's "FitDance Special" is called just "FitDance", like the other FitDance classes.
update public.class_templates set title = 'FitDance' where title = 'FitDance Special';
update public.class_sessions set title = 'FitDance'
  where title = 'FitDance Special' and starts_at > now();
