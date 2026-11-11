-- Drop Studios — notifications are on by default; members can turn them off.
--
-- notify_email: reminders and updates by email.
-- notify_push:  phone notifications. The browser still asks the member to
--               allow them once; the app offers that right after sign-in.
alter table public.profiles
  add column notify_email boolean not null default true,
  add column notify_push boolean not null default true;
grant update (notify_email, notify_push) on public.profiles to authenticated;

-- Sign-up form: "Send me reminders and class updates" (ticked by default).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dob date := public._safe_date(new.raw_user_meta_data ->> 'date_of_birth');
  v_notify boolean := coalesce((new.raw_user_meta_data ->> 'notifications')::boolean, true);
begin
  if v_dob is not null and (v_dob > current_date or v_dob < date '1900-01-01') then
    v_dob := null;
  end if;
  insert into public.profiles (id, full_name, email, phone, date_of_birth, notify_email, notify_push)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    v_dob,
    v_notify,
    v_notify
  );
  return new;
end;
$$;

-- The sender only gets an email address for members who want emails (phone
-- notifications go to the devices a member has switched on).
create or replace function public.claim_notifications(p_limit int default 50)
returns table (id bigint, user_id uuid, kind text, payload jsonb, email text, full_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with picked as (
    select o.id from public.notification_outbox o
    where o.sent_at is null and o.attempts < 5
      and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
    order by o.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), claimed as (
    update public.notification_outbox o
    set claimed_at = now(), attempts = o.attempts + 1
    from picked where o.id = picked.id
    returning o.id, o.user_id, o.kind, o.payload
  )
  select c.id, c.user_id, c.kind, c.payload, case when p.notify_email then p.email end, p.full_name
  from claimed c join public.profiles p on p.id = c.user_id;
end;
$$;
