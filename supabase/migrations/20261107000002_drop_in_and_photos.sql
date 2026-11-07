-- Drop Studios — Drop In classes and required profile photos.
--
-- Drop In: any regular class can be bought on its own at its style's price
-- (dance_styles.drop_in_price_cents). It reuses the workshop-ticket flow: the
-- spot is held while the customer pays and the signed payment webhook confirms
-- it. Paid Drop Ins, like tickets, are refunded by the studio, not in the app.
--
-- Profile photo: customers must upload a photo (private "avatars" storage
-- bucket, own folder) before booking or buying. Enforced here, not only in the UI.

-- ---------------------------------------------------------------------------
-- Drop In prices per style (admin-editable; null = not sold as a Drop In)
-- ---------------------------------------------------------------------------
alter table public.dance_styles
  add column drop_in_price_cents int check (drop_in_price_cents >= 0);

update public.dance_styles set drop_in_price_cents = 1500
  where slug in ('fitdance', 'reggaeton', 'commercial', 'hip-hop') and drop_in_price_cents is null;
update public.dance_styles set drop_in_price_cents = 1700
  where slug in ('heels', 'jazz-funk', 'choreography') and drop_in_price_cents is null;

alter table public.payments drop constraint payments_kind_target;
alter table public.payments add constraint payments_kind_target check (
  (kind = 'membership' and plan_id is not null and session_id is null)
  or (kind in ('ticket', 'drop_in') and session_id is not null and plan_id is null)
);

-- ---------------------------------------------------------------------------
-- Profile photos
-- ---------------------------------------------------------------------------
alter table public.profiles add column avatar_path text;
grant update (avatar_path) on public.profiles to authenticated;

-- A customer may only point their profile at a file in their own folder.
create or replace function public.guard_avatar_path()
returns trigger
language plpgsql
as $$
begin
  if new.avatar_path is not null and new.avatar_path not like new.id::text || '/%' then
    raise exception 'invalid_avatar_path';
  end if;
  return new;
end;
$$;
create trigger profiles_avatar_guard before insert or update of avatar_path on public.profiles
  for each row execute function public.guard_avatar_path();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Files live at avatars/<user id>/<file>. Owners manage their own; staff can view all.
create policy avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- True when the customer has uploaded at least one photo to their folder.
create or replace function public.has_profile_photo(p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from storage.objects
    where bucket_id = 'avatars'
      and (storage.foldername(name))[1] = coalesce(p_user_id, auth.uid())::text
  );
$$;

-- ---------------------------------------------------------------------------
-- Booking and purchases now require a photo
-- ---------------------------------------------------------------------------
create or replace function public.book_class(p_session_id uuid, p_membership_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  s public.class_sessions;
  m public.memberships;
  cand public.memberships;
  v_issue text;
  v_live_issue text;
  v_dead_issue text;
  v_booking_id uuid;
  v_remaining int;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(v_uid) then perform public._fail('profile_photo_required'); end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;

  v_issue := public._session_issue(s, v_uid);
  if v_issue is not null then perform public._fail(v_issue); end if;

  if p_membership_id is not null then
    select * into m from public.memberships
    where id = p_membership_id and user_id = v_uid for update;
    if not found then perform public._fail('membership_not_found'); end if;
    v_issue := public._membership_issue(m, s);
    if v_issue is not null then perform public._fail(v_issue); end if;
  else
    -- Use the pack that expires soonest; packs awaiting activation go last.
    for cand in
      select * from public.memberships
      where user_id = v_uid
      order by (activated_at is null), expires_at, created_at
      for update
    loop
      v_issue := public._membership_issue(cand, s);
      if v_issue is null then
        m := cand;
        exit;
      elsif v_issue in ('membership_expired', 'no_classes_left', 'membership_cancelled') then
        v_dead_issue := coalesce(v_dead_issue, v_issue);
      else
        v_live_issue := coalesce(v_live_issue, v_issue);
      end if;
    end loop;
    if m.id is null then
      perform public._fail(coalesce(v_live_issue, v_dead_issue, 'no_membership'));
    end if;
  end if;

  if m.activated_at is null then
    update public.memberships mm
    set activated_at = now(),
        base_expires_at = public.compute_expiry(now(), pu.validity_days, 0),
        expires_at = public.compute_expiry(now(), pu.validity_days, 0)
    from public.membership_purchases pu
    where mm.id = m.id and pu.id = mm.purchase_id;
  end if;

  begin
    insert into public.bookings (user_id, session_id, membership_id)
    values (v_uid, s.id, m.id)
    returning id into v_booking_id;
  exception when unique_violation then
    perform public._fail('already_booked');
  end;

  update public.memberships set classes_remaining = classes_remaining - 1
  where id = m.id
  returning classes_remaining into v_remaining;

  insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, booking_id, actor_id)
  values (m.id, v_uid, -1, v_remaining, 'booking', v_booking_id, v_uid);

  update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

  return jsonb_build_object(
    'booking_id', v_booking_id,
    'membership_id', m.id,
    'classes_remaining', v_remaining
  );
end;
$$;

create or replace function public.create_checkout(
  p_plan_id uuid,
  p_selected_style_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'square'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_snap jsonb;
  pay public.payments;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(v_uid) then perform public._fail('profile_photo_required'); end if;
  if p_provider not in ('square', 'stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;

  -- Serialise checkouts per customer.
  perform 1 from public.profiles where id = v_uid for update;

  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if pay.plan_id <> p_plan_id then perform public._fail('idempotency_conflict'); end if;
  else
    v_snap := public._plan_snapshot(v_uid, p_plan_id, p_selected_style_id, true);

    if (v_snap ->> 'first_time_only')::boolean and exists (
      select 1 from public.payments
      where user_id = v_uid and status = 'pending' and (plan_snapshot ->> 'first_time_only')::boolean
        and created_at > now() - interval '1 hour'
    ) then
      perform public._fail('intro_checkout_in_progress');
    end if;

    insert into public.payments (
      user_id, plan_id, selected_style_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, p_plan_id, (v_snap ->> 'selected_style_id')::uuid, v_snap,
      (v_snap ->> 'price_cents')::int, v_snap ->> 'currency',
      p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid
    ) returning * into pay;
  end if;

  return jsonb_build_object(
    'payment_id', pay.id,
    'status', pay.status,
    'amount_cents', pay.amount_cents,
    'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name',
    'class_count', (pay.plan_snapshot ->> 'class_count')::int,
    'provider', pay.provider,
    'provider_session_id', pay.provider_session_id,
    'is_test', pay.is_test
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Single-class checkout: workshop tickets and Drop Ins
-- ---------------------------------------------------------------------------
create or replace function public.create_ticket_checkout(
  p_session_id uuid,
  p_idempotency_key text,
  p_provider public.payment_provider default 'square'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  cfg public.app_settings := public._settings();
  s public.class_sessions;
  pay public.payments;
  v_booking_id uuid;
  v_kind public.payment_kind;
  v_price int;
  v_label text;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if not public.has_profile_photo(v_uid) then perform public._fail('profile_photo_required'); end if;
  if p_provider not in ('square', 'stripe', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;

  select * into s from public.class_sessions where id = p_session_id for update;
  if not found then perform public._fail('session_not_found'); end if;

  perform public.release_expired_holds(s.id);
  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if not found then
    -- Returning to a checkout already in progress: resume it instead of failing.
    select p.* into pay from public.payments p
    join public.bookings b on b.id = p.booking_id
    where p.user_id = v_uid and p.session_id = s.id and p.status = 'pending' and b.status = 'pending_payment';
  end if;
  if not found then
    select * into s from public.class_sessions where id = p_session_id;

    if s.is_special then
      v_kind := 'ticket';
      v_price := s.ticket_price_cents;
      v_label := 'Ticket: ';
      if v_price is null then perform public._fail('tickets_not_available'); end if;
    else
      v_kind := 'drop_in';
      select drop_in_price_cents into v_price from public.dance_styles where id = s.style_id;
      v_label := 'Drop In: ';
      if v_price is null then perform public._fail('drop_in_not_available'); end if;
      if s.starts_at > now() + make_interval(days => cfg.booking_window_days) then
        perform public._fail('outside_booking_window');
      end if;
    end if;
    if s.status = 'cancelled' then perform public._fail('session_cancelled'); end if;
    if s.starts_at <= now() then perform public._fail('session_started'); end if;
    if exists (
      select 1 from public.bookings where user_id = v_uid and session_id = s.id
        and status in ('booked', 'attended', 'no_show', 'pending_payment')
    ) then perform public._fail('already_booked'); end if;
    if s.booked_count >= s.capacity then perform public._fail('session_full'); end if;

    insert into public.bookings (user_id, session_id, status, hold_expires_at)
    values (v_uid, s.id, 'pending_payment', now() + interval '35 minutes')
    returning id into v_booking_id;
    update public.class_sessions set booked_count = booked_count + 1 where id = s.id;

    insert into public.payments (
      user_id, kind, session_id, booking_id, plan_snapshot, amount_cents, currency,
      provider, is_test, idempotency_key, created_by
    ) values (
      v_uid, v_kind, s.id, v_booking_id,
      jsonb_build_object('kind', v_kind, 'plan_name', v_label || s.title, 'title', s.title,
                         'starts_at', s.starts_at, 'price_cents', v_price, 'currency', 'EUR'),
      v_price, 'EUR', p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid
    ) returning * into pay;
    update public.bookings set payment_id = pay.id where id = v_booking_id;
  elsif pay.session_id is distinct from p_session_id then
    perform public._fail('idempotency_conflict');
  end if;

  return jsonb_build_object(
    'payment_id', pay.id,
    'kind', pay.kind,
    'status', pay.status,
    'amount_cents', pay.amount_cents,
    'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name',
    'class_count', null,
    'provider', pay.provider,
    'provider_session_id', pay.provider_session_id,
    'is_test', pay.is_test
  );
end;
$$;

create or replace function public.fulfill_payment(
  p_payment_id uuid,
  p_provider public.payment_provider,
  p_provider_ref text,
  p_provider_event_id text,
  p_amount_cents int,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments;
  v_membership_id uuid;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;

  if pay.status = 'succeeded' then
    if pay.kind <> 'membership' then
      return jsonb_build_object('ok', true, 'booking_id', pay.booking_id, 'duplicate', true);
    end if;
    select m.id into v_membership_id
    from public.membership_purchases pu join public.memberships m on m.purchase_id = pu.id
    where pu.payment_id = pay.id;
    return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', true);
  end if;

  if pay.provider <> p_provider then perform public._fail('provider_mismatch'); end if;
  if pay.status not in ('pending', 'cancelled', 'failed') then perform public._fail('payment_not_fulfillable', pay.status::text); end if;

  if p_amount_cents is distinct from pay.amount_cents or upper(p_currency) is distinct from upper(pay.currency) then
    update public.payments set status = 'failed',
      failure_reason = format('amount mismatch: expected %s %s, got %s %s', pay.amount_cents, pay.currency, p_amount_cents, p_currency)
    where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  update public.payments
  set status = 'succeeded', completed_at = now(), provider_payment_ref = p_provider_ref,
      provider_event_id = p_provider_event_id, failure_reason = null
  where id = pay.id
  returning * into pay;

  if pay.kind <> 'membership' then
    return public._confirm_ticket(pay) || jsonb_build_object('duplicate', false);
  end if;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$$;

create or replace function public.booking_options(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  cfg public.app_settings := public._settings();
  s public.class_sessions;
  m public.memberships;
  v_issue text;
  v_session_issue text;
  v_options jsonb := '[]';
  v_eligible uuid;
  v_alts jsonb := '[]';
  alt public.class_sessions;
  v_count int := 0;
  mine public.bookings;
begin
  select * into s from public.class_sessions where id = p_session_id;
  if not found then perform public._fail('session_not_found'); end if;

  v_session_issue := public._session_issue(s, v_uid);

  if v_uid is null then
    return jsonb_build_object('authenticated', false, 'session_issue', v_session_issue,
      'ticket_price_cents', case when s.is_special then s.ticket_price_cents end,
      'drop_in_price_cents', case when not s.is_special then (select drop_in_price_cents from public.dance_styles where id = s.style_id) end);
  end if;

  select * into mine from public.bookings
  where user_id = v_uid and session_id = s.id and status in ('booked', 'pending_payment')
  order by booked_at desc limit 1;

  for m in
    select * from public.memberships
    where user_id = v_uid and admin_status = 'valid'
    order by (activated_at is null), expires_at, created_at
  loop
    v_issue := public._membership_issue(m, s);
    if v_issue is null and v_eligible is null then v_eligible := m.id; end if;
    v_options := v_options || jsonb_build_object(
      'membership_id', m.id, 'plan_name', m.plan_name, 'state', public.state(m),
      'classes_remaining', m.classes_remaining, 'issue', v_issue
    );
  end loop;

  if (v_session_issue is not null or v_eligible is null) and not s.is_special then
    for alt in
      select * from public.class_sessions c
      where c.id <> s.id and c.status = 'scheduled'
        and c.starts_at > now()
        and c.starts_at <= now() + make_interval(days => cfg.booking_window_days)
        and c.booked_count < c.capacity
      order by (c.style_id = s.style_id) desc, abs(extract(epoch from c.starts_at - s.starts_at))
      limit 60
    loop
      exit when v_count >= 4;
      if public._session_issue(alt, v_uid) is null and exists (
        select 1 from public.memberships mm
        where mm.user_id = v_uid and mm.admin_status = 'valid'
          and public._membership_issue(mm, alt) is null
      ) then
        v_alts := v_alts || jsonb_build_object(
          'id', alt.id, 'title', alt.title, 'starts_at', alt.starts_at,
          'spots_left', alt.capacity - alt.booked_count
        );
        v_count := v_count + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'authenticated', true,
    'session_issue', v_session_issue,
    'my_booking_id', case when mine.status = 'booked' then mine.id end,
    'my_booking_is_ticket', mine.status = 'booked' and mine.payment_id is not null,
    'pending_hold_booking_id', case when mine.status = 'pending_payment' then mine.id end,
    'ticket_price_cents', case when s.is_special then s.ticket_price_cents end,
    'drop_in_price_cents', case when not s.is_special then (select drop_in_price_cents from public.dance_styles where id = s.style_id) end,
    'has_profile_photo', public.has_profile_photo(v_uid),
    'eligible_membership_id', v_eligible,
    'memberships', v_options,
    'alternatives', v_alts,
    'cancellation_cutoff_minutes', cfg.cancellation_cutoff_minutes,
    'late_cancel_restores_class', cfg.late_cancel_restores_class
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reporting: tickets and Drop Ins
-- ---------------------------------------------------------------------------
create or replace function public.admin_ticket_sales(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := (public._settings()).timezone;
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
begin
  perform public._require_admin();
  return (
    select jsonb_build_object(
      'tickets_sold', count(*) filter (where kind = 'ticket'),
      'ticket_revenue_cents', coalesce(sum(amount_cents) filter (where kind = 'ticket'), 0),
      'drop_ins_sold', count(*) filter (where kind = 'drop_in'),
      'drop_in_revenue_cents', coalesce(sum(amount_cents) filter (where kind = 'drop_in'), 0),
      'refunds_to_review', (
        select count(*) from public.audit_log
        where action = 'ticket_refund_required' and created_at >= v_start and created_at < v_end
      )
    )
    from public.payments
    where kind in ('ticket', 'drop_in') and status = 'succeeded' and not is_test
      and completed_at >= v_start and completed_at < v_end
  );
end;
$$;

revoke execute on function public.has_profile_photo(uuid) from public, anon;
grant execute on function public.has_profile_photo(uuid) to authenticated;
