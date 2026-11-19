-- Marketing emails need a clear, unticked opt-in (ePrivacy/GDPR). Members can say yes at sign-up, at checkout
-- or on their account page; the time of consent (and of withdrawing it) is recorded.
alter table public.profiles add column if not exists marketing_consent_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dob date := public._safe_date(new.raw_user_meta_data ->> 'date_of_birth');
  v_notify boolean := coalesce((new.raw_user_meta_data ->> 'notifications')::boolean, true);
  v_marketing boolean := coalesce((new.raw_user_meta_data ->> 'marketing')::boolean, false);
begin
  if v_dob is not null and (v_dob > current_date or v_dob < date '1900-01-01') then
    v_dob := null;
  end if;
  insert into public.profiles (id, full_name, email, phone, date_of_birth, notify_email, notify_push, marketing_opt_in)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    v_dob,
    v_notify,
    v_notify,
    v_marketing
  );
  return new;
end;
$$;

create or replace function public._marketing_consent_time() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.marketing_opt_in and (tg_op = 'INSERT' or not old.marketing_opt_in) then new.marketing_consent_at := now(); end if;
  if not new.marketing_opt_in and tg_op = 'UPDATE' and old.marketing_opt_in then new.marketing_consent_at := null; end if;
  return new;
end;
$$;
drop trigger if exists profiles_marketing_consent on public.profiles;
create trigger profiles_marketing_consent before insert or update of marketing_opt_in on public.profiles
  for each row execute function public._marketing_consent_time();
update public.profiles set marketing_consent_at = coalesce(marketing_consent_at, updated_at, created_at) where marketing_opt_in and marketing_consent_at is null;
