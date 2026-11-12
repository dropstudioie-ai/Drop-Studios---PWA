-- Drop Studios — admins edit a member's profile from the Members page.
-- Name, phone, date of birth, marketing and notification preferences, and
-- removing the profile photo. Every change is written to the audit log with
-- the old and new values. (The login email is changed by the admin-member-email
-- edge function, which also updates the sign-in account.)
create or replace function public.admin_update_member(
  p_user_id uuid,
  p_full_name text,
  p_phone text,
  p_date_of_birth date,
  p_marketing_opt_in boolean,
  p_notify_email boolean,
  p_notify_push boolean,
  p_remove_photo boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  old public.profiles;
  new_p public.profiles;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  perform public._require_admin();
  select * into old from public.profiles where id = p_user_id for update;
  if not found then perform public._fail('member_not_found'); end if;
  if coalesce(btrim(p_full_name), '') = '' then perform public._fail('name_required'); end if;
  if p_date_of_birth is not null and (p_date_of_birth > current_date or p_date_of_birth < date '1900-01-01') then
    perform public._fail('invalid_date_of_birth');
  end if;

  update public.profiles set
    full_name = btrim(p_full_name),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    date_of_birth = p_date_of_birth,
    marketing_opt_in = coalesce(p_marketing_opt_in, marketing_opt_in),
    notify_email = coalesce(p_notify_email, notify_email),
    notify_push = coalesce(p_notify_push, notify_push),
    avatar_path = case when p_remove_photo then null else avatar_path end,
    updated_at = now()
  where id = p_user_id
  returning * into new_p;

  for k in select unnest(array['full_name', 'phone', 'date_of_birth', 'marketing_opt_in', 'notify_email', 'notify_push', 'avatar_path']) loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new_p) -> k) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new_p) -> k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    perform public._audit('member_updated', 'profile', p_user_id::text, v_changes);
  end if;
  return jsonb_build_object('ok', true, 'changed', v_changes <> '{}'::jsonb);
end;
$$;

-- Used by the admin-member-email function after the sign-in email is changed.
create or replace function public.admin_record_member_email(p_user_id uuid, p_email text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_old text;
begin
  select email into v_old from public.profiles where id = p_user_id for update;
  update public.profiles set email = lower(btrim(p_email)), updated_at = now() where id = p_user_id;
  insert into public.audit_log (action, entity_type, entity_id, actor_id, details)
  values ('member_email_changed', 'profile', p_user_id::text, p_actor, jsonb_build_object('from', v_old, 'to', lower(btrim(p_email))));
end;
$$;

revoke execute on function public.admin_update_member(uuid, text, text, date, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.admin_update_member(uuid, text, text, date, boolean, boolean, boolean, boolean) to authenticated;
revoke execute on function public.admin_record_member_email(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_record_member_email(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Admins cancel (and reinstate) a class-pack membership.
-- Monthly memberships are cancelled through their subscription instead.
-- Upcoming bookings made with it are cancelled and the member is told.
-- Refunds stay a separate admin step (Payments → Refund).
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_membership(p_membership_id uuid, p_reason text, p_notify boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.memberships;
  b record;
  v_n int := 0;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then perform public._fail('membership_not_found'); end if;
  if m.admin_status = 'cancelled' then perform public._fail('membership_cancelled'); end if;
  if m.subscription_id is not null and exists (
    select 1 from public.member_subscriptions where id = m.subscription_id and status in ('active', 'past_due', 'cancel_scheduled')
  ) then perform public._fail('cancel_monthly_instead'); end if;

  for b in
    select bk.id, bk.user_id, s.title, s.starts_at from public.bookings bk
    join public.class_sessions s on s.id = bk.session_id
    where bk.membership_id = m.id and bk.status = 'booked' and s.starts_at > now()
  loop
    perform public._cancel_booking(b.id, true, 'Membership cancelled: ' || btrim(p_reason), true);
    v_n := v_n + 1;
  end loop;

  update public.memberships set admin_status = 'cancelled' where id = m.id;

  if p_notify then
    insert into public.notification_outbox (user_id, kind, payload)
    values (m.user_id, 'membership_cancelled', jsonb_build_object('plan_name', m.plan_name, 'reason', btrim(p_reason), 'bookings_cancelled', v_n));
  end if;
  perform public._audit('membership_cancelled', 'membership', m.id::text,
    jsonb_build_object('reason', btrim(p_reason), 'bookings_cancelled', v_n, 'classes_remaining', m.classes_remaining));
  return jsonb_build_object('ok', true, 'bookings_cancelled', v_n);
end;
$$;

create or replace function public.admin_reinstate_membership(p_membership_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m public.memberships;
begin
  perform public._require_admin();
  if coalesce(btrim(p_reason), '') = '' then perform public._fail('reason_required'); end if;
  select * into m from public.memberships where id = p_membership_id for update;
  if not found then perform public._fail('membership_not_found'); end if;
  if m.admin_status <> 'cancelled' then perform public._fail('membership_not_cancelled'); end if;
  update public.memberships set admin_status = 'valid' where id = m.id;
  perform public._audit('membership_reinstated', 'membership', m.id::text, jsonb_build_object('reason', btrim(p_reason)));
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_cancel_membership(uuid, text, boolean), public.admin_reinstate_membership(uuid, text) from public, anon;
grant execute on function public.admin_cancel_membership(uuid, text, boolean), public.admin_reinstate_membership(uuid, text) to authenticated;
