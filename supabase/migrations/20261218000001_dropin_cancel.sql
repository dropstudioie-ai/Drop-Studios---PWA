-- Members can cancel a paid Drop In up to 1 hour before class and choose:
--   • a class credit worth what they paid (a €15 credit can't book a €17 class), valid 1 month, or
--   • a refund request, which an admin approves (refunded in Square) or declines (they get the credit instead).
alter table public.memberships add column if not exists max_class_price_cents int;
alter table public.ticket_choices drop constraint if exists ticket_choices_status_check;
alter table public.ticket_choices add constraint ticket_choices_status_check check (status in ('waiting', 'credit', 'refund', 'refunded', 'refund_requested'));
alter table public.ticket_choices add column if not exists by_member boolean not null default false;
alter table public.app_settings add column if not exists dropin_cancel_minutes int not null default 60;

create or replace function public._membership_issue(m memberships, s class_sessions)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  pur public.membership_purchases;
  v_expiry timestamptz;
begin
  select * into pur from public.membership_purchases where id = m.purchase_id;

  if m.admin_status = 'cancelled' then return 'membership_cancelled'; end if;
  if m.activated_at is not null and m.expires_at <= now() then return 'membership_expired'; end if;
  if m.classes_remaining <= 0 then return 'no_classes_left'; end if;

  -- A pack activated by its first booking would start now.
  v_expiry := coalesce(m.expires_at, public.compute_expiry(now(), pur.validity_days, 0));
  if s.starts_at >= v_expiry then return 'class_after_expiry'; end if;

  if public._is_paused_on(m.id, public._local_today()) then return 'membership_paused'; end if;
  if public._is_paused_on(m.id, public._local_date(s.starts_at)) then return 'class_in_pause'; end if;

  if s.is_special then return 'special_event'; end if;
  -- A credit from a cancelled Drop In is worth what was paid: only classes at that price or less.
  if m.max_class_price_cents is not null
     and coalesce((select drop_in_price_cents from public.dance_styles where id = s.style_id), 0) > m.max_class_price_cents
  then return 'class_price_above_credit'; end if;
  if not (s.style_id = any (pur.allowed_style_ids)) then return 'style_not_included'; end if;

  if s.template_id = any (pur.excluded_template_ids)
     or exists (select 1 from public.plan_exclusions e where e.plan_id = pur.plan_id and e.session_id = s.id)
     -- Exclusions of recurring classes added after purchase only apply to
     -- classes that did not exist at purchase time (terms are preserved).
     or exists (
       select 1 from public.plan_exclusions e
       join public.class_templates t on t.id = e.template_id
       where e.plan_id = pur.plan_id and e.template_id = s.template_id
         and t.created_at > pur.purchased_at
     )
  then return 'class_excluded'; end if;

  return null;
end;
$function$;


create or replace function public._decide_ticket_choice(p_id uuid, p_credit boolean, p_by uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c public.ticket_choices;
  pay public.payments; snap jsonb; mid uuid;
  v_days int := (select ticket_credit_days from public.app_settings limit 1);
  pl uuid := (select id from public.membership_plans where code = 'intro-3');
begin
  select * into c from public.ticket_choices where id = p_id for update;
  if not found then perform public._fail('choice_not_found'); end if;
  if c.status not in ('waiting', 'refund_requested') then perform public._fail('choice_already_made'); end if;
  if p_credit then
    snap := jsonb_build_object('plan_id', pl, 'plan_code', 'class-credit', 'plan_name', 'Class credit',
      'class_count', 1, 'validity_days', v_days, 'style_access', 'multi', 'billing_interval', 'one_off',
      'allowed_style_ids', (select coalesce(jsonb_agg(id), '[]') from public.dance_styles where is_active),
      'excluded_template_ids', '[]'::jsonb, 'selected_style_id', null);
    insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, idempotency_key, kind, status, completed_at)
    values (c.user_id, pl, snap, 0, 'EUR', 'manual', false, 'ticket-credit:' || c.id, 'membership', 'succeeded', now()) returning * into pay;
    mid := public._grant_membership(c.user_id, pay, snap, 1, now() + make_interval(days => v_days), null, 'grant_purchase',
      'Credit for cancelled ' || c.class_title || ' (' || to_char(c.class_starts_at at time zone 'Europe/Dublin', 'DD Mon') || ')', 'Class credit');
    update public.memberships set max_class_price_cents = c.amount_cents where id = mid;   -- worth what was paid
    update public.ticket_choices set status = 'credit', membership_id = mid, decided_by = p_by, decided_at = now() where id = c.id;
    perform public._audit('ticket_credit_given', 'payment', c.payment_id::text, jsonb_build_object('choice_id', c.id, 'membership_id', mid, 'user_id', c.user_id));
    return jsonb_build_object('choice', 'credit', 'membership_id', mid, 'expires_at', now() + make_interval(days => v_days));
  end if;
  update public.ticket_choices set status = 'refund', decided_by = p_by, decided_at = now() where id = c.id;
  -- The studio refunds it in Square (Admin -> member -> Payments -> Refund).
  perform public._audit('ticket_refund_required', 'payment', c.payment_id::text,
    jsonb_build_object('booking_id', c.booking_id, 'user_id', c.user_id, 'choice_id', c.id));
  perform public._assistant_notify_owner('ticket_refund_requested', jsonb_build_object('choice_id', c.id, 'user_id', c.user_id,
    'member', (select full_name from public.profiles where id = c.user_id), 'title', c.class_title, 'starts_at', c.class_starts_at,
    'amount_cents', c.amount_cents), 'ticket_refund:' || c.id);
  return jsonb_build_object('choice', 'refund');
end;
$function$;


/** Member: cancel a paid Drop In (not an event ticket) at least an hour before, for a credit or a refund request. */
create or replace function public.cancel_drop_in(p_booking_id uuid, p_credit boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.bookings; s public.class_sessions; pay public.payments; c public.ticket_choices; r jsonb;
  v_mins int := (select dropin_cancel_minutes from public.app_settings limit 1);
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into b from public.bookings where id = p_booking_id and user_id = auth.uid();
  if not found then perform public._fail('booking_not_found'); end if;
  if b.status <> 'booked' then perform public._fail('booking_not_active'); end if;
  select * into pay from public.payments where id = b.payment_id;
  if not found or pay.kind <> 'drop_in' or pay.status <> 'succeeded' then perform public._fail('ticket_contact_studio'); end if;
  select * into s from public.class_sessions where id = b.session_id;
  if s.starts_at - make_interval(mins => v_mins) < now() then perform public._fail('dropin_cancel_too_late', v_mins::text); end if;

  perform public._cancel_booking(b.id, false, case when p_credit then 'Cancelled by member: class credit' else 'Cancelled by member: refund requested' end, false);
  select * into c from public.ticket_choices where booking_id = b.id;
  if c.id is null then perform public._fail('ticket_contact_studio'); end if;
  update public.ticket_choices set by_member = true where id = c.id;
  -- They already chose: no "credit or refund?" email.
  delete from public.notification_outbox where dedupe_key = 'ticket_choice:' || c.id and sent_at is null;

  if p_credit then
    r := public._decide_ticket_choice(c.id, true, auth.uid());
    return r || jsonb_build_object('credit_cents', c.amount_cents);
  end if;
  update public.ticket_choices set status = 'refund_requested', decided_by = auth.uid(), decided_at = now() where id = c.id;
  perform public._audit('refund_requested', 'payment', pay.id::text, jsonb_build_object('choice_id', c.id, 'booking_id', b.id));
  perform public._assistant_notify_owner('ticket_refund_requested', jsonb_build_object('choice_id', c.id, 'user_id', c.user_id,
    'member', (select full_name from public.profiles where id = c.user_id), 'title', c.class_title, 'starts_at', c.class_starts_at,
    'amount_cents', c.amount_cents, 'needs_approval', true), 'ticket_refund:' || c.id);
  return jsonb_build_object('choice', 'refund_requested');
end;
$$;

/** Admin: approve a member's refund request (after refunding it in Square) or decline it (they get the class credit). */
create or replace function public.admin_decide_refund_request(p_choice_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.ticket_choices; r jsonb;
begin
  perform public._require_admin();
  if not public.can_view_finance() then perform public._fail('forbidden'); end if;
  select * into c from public.ticket_choices where id = p_choice_id for update;
  if not found or c.status <> 'refund_requested' then perform public._fail('choice_not_found'); end if;
  if p_approve then
    update public.ticket_choices set status = 'refunded', decided_by = auth.uid(), decided_at = now() where id = c.id;
    r := jsonb_build_object('status', 'refunded');
  else
    r := public._decide_ticket_choice(c.id, true, auth.uid());
  end if;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (c.user_id, 'refund_decided', jsonb_build_object('approved', p_approve, 'title', c.class_title, 'starts_at', c.class_starts_at,
    'amount_cents', c.amount_cents, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'credit_expires_at', r ->> 'expires_at'), 'refund_decided:' || c.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit(case when p_approve then 'refund_approved' else 'refund_declined' end, 'ticket_choice', c.id::text, jsonb_build_object('note', p_note));
  return r;
end;
$$;

create or replace function public.admin_approvals()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_fin boolean;
begin
  perform public._require_admin();
  v_fin := public.can_view_finance();
  return jsonb_build_object(
    'workshops', (select count(*) from public.studio_events where status = 'pending'),
    'time_off', (select count(*) from public.instructor_time_off where status = 'pending' and ends_on >= public._local_today()),
    'rentals', (select count(*) from public.rental_bookings where status = 'pending_approval' and starts_at > now()),
    'rental_blocks', (select count(distinct title) from public.rental_blocks
                      where confirmed_at is null and confirm_by is not null and starts_at > now()),
    'rental_blocks_by', (select min(confirm_by) from public.rental_blocks
                         where confirmed_at is null and confirm_by is not null and starts_at > now()),
    'dm_drafts', (select count(*) from public.assistant_messages where status = 'draft'),
    'comment_drafts', (select count(*) from public.assistant_comments where reply_status = 'draft' and reply_text is not null),
    'questions', (select count(*) from public.assistant_guidance where status = 'open'),
    'payments_to_review', case when v_fin then (select count(*) from public.payments where review_reason is not null) else 0 end,
    'refunds', case when v_fin then (select count(*) from public.ticket_choices where status = 'refund') else 0 end,
    'refund_requests', case when v_fin then (select count(*) from public.ticket_choices where status = 'refund_requested') else 0 end
  );
end;
$function$;


revoke all on function public.cancel_drop_in(uuid, boolean), public.admin_decide_refund_request(uuid, boolean, text) from public, anon;
grant execute on function public.cancel_drop_in(uuid, boolean), public.admin_decide_refund_request(uuid, boolean, text) to authenticated;
