-- Promos in the same spacing group are never on Instagram together (Thamires waits until a sibling's Story is ~24h old).
alter table public.assistant_promos add column if not exists spacing_group text;
alter table public.assistant_promos add column if not exists last_posted_at timestamptz;
update public.assistant_promos set last_posted_at = (last_posted_on::timestamp + time '12:01') at time zone 'Europe/Dublin'
where last_posted_at is null and last_posted_on is not null;
