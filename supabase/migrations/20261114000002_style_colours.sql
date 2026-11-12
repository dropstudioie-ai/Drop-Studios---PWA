-- Drop Studios — style colours match the class images.
update public.dance_styles set color = case slug
  when 'fitdance' then '#FF7A00' when 'commercial' then '#2F5BFF' when 'hip-hop' then '#F5B400'
  when 'heels' then '#E5243B' when 'jazz-funk' then '#8B5CF6' when 'reggaeton' then '#E8287A'
  when 'choreography' then '#12B5A2' else color end
where slug in ('fitdance', 'commercial', 'hip-hop', 'heels', 'jazz-funk', 'reggaeton', 'choreography');
