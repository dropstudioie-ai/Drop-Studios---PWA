-- Members ask to cancel their monthly membership (a discreet link); an admin reviews and approves or declines.
create table if not exists public.cancel_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subscription_id uuid references public.member_subscriptions(id) on delete cascade,
  reason text check (char_length(reason) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  admin_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists cancel_requests_one_pending on public.cancel_requests (subscription_id) where status = 'pending';
alter table public.cancel_requests enable row level security;
revoke all on public.cancel_requests from anon, authenticated;
grant select on public.cancel_requests to authenticated;
drop policy if exists cancel_requests_read on public.cancel_requests;
create policy cancel_requests_read on public.cancel_requests for select to authenticated using (user_id = auth.uid() or public.is_admin());

create or replace function public.request_membership_cancel(p_subscription_id uuid, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.member_subscriptions; v uuid;
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  select * into s from public.member_subscriptions where id = p_subscription_id and user_id = auth.uid();
  if not found then perform public._fail('not_found'); end if;
  if s.status not in ('active', 'past_due') then perform public._fail('cancel_not_possible'); end if;
  if exists (select 1 from public.cancel_requests where subscription_id = s.id and status = 'pending') then perform public._fail('cancel_already_requested'); end if;
  insert into public.cancel_requests (user_id, subscription_id, reason) values (auth.uid(), s.id, nullif(btrim(coalesce(p_reason, '')), '')) returning id into v;
  perform public._audit('cancel_requested', 'subscription', s.id::text, jsonb_build_object('request_id', v));
  perform public._assistant_notify_owner('cancel_requested', jsonb_build_object('member', (select full_name from public.profiles where id = auth.uid()),
    'user_id', auth.uid(), 'plan', s.plan_snapshot ->> 'plan_name', 'reason', nullif(btrim(coalesce(p_reason, '')), '')), 'cancel_req:' || v);
  return v;
end;
$$;

create or replace function public.withdraw_cancel_request(p_id uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.cancel_requests set status = 'withdrawn', decided_at = now() where id = p_id and user_id = auth.uid() and status = 'pending';
$$;

/** Admin: approve (after cancelling the subscription through the app, which also tells Square) or decline. */
create or replace function public.admin_decide_cancel_request(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.cancel_requests;
begin
  perform public._require_admin();
  select * into r from public.cancel_requests where id = p_id for update;
  if not found or r.status <> 'pending' then perform public._fail('not_found'); end if;
  update public.cancel_requests set status = case when p_approve then 'approved' else 'declined' end, admin_note = nullif(btrim(coalesce(p_note, '')), ''),
    decided_at = now(), decided_by = auth.uid() where id = r.id;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (r.user_id, 'cancel_decided', jsonb_build_object('approved', p_approve, 'note', nullif(btrim(coalesce(p_note, '')), ''),
    'ends_on', (select coalesce(cancel_effective_on, current_period_ends_on) from public.member_subscriptions where id = r.subscription_id)), 'cancel_decided:' || r.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit(case when p_approve then 'cancel_request_approved' else 'cancel_request_declined' end, 'subscription', r.subscription_id::text, jsonb_build_object('note', p_note));
end;
$$;

/** Admin members overview: how many people are active, paused, ending. */
create or replace function public.admin_member_counts()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (with st as (
      select m.user_id, bool_or(public.state(m) in ('active', 'pending_activation')) act, bool_or(public.state(m) = 'paused') pau
      from public.memberships m where not m.is_test and m.admin_status = 'valid' group by m.user_id)
    select jsonb_build_object(
      'active', (select count(*) from st where act),
      'paused', (select count(*) from st where pau and not act),
      'monthly', (select count(*) from public.member_subscriptions where status in ('active', 'past_due')),
      'ending', (select count(*) from public.member_subscriptions where status = 'cancel_scheduled'),
      'cancel_requests', (select count(*) from public.cancel_requests where status = 'pending'),
      'total', (select count(*) from public.profiles where role = 'customer')));
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
    'refund_requests', case when v_fin then (select count(*) from public.ticket_choices where status = 'refund_requested') else 0 end,
    'cancel_requests', (select count(*) from public.cancel_requests where status = 'pending'),
    'held_moves', (select count(*) from public.old_app_pending_moves where held_at is not null and applied_at is null and declined_at is null)
  );
end;
$function$;

revoke all on function public.request_membership_cancel(uuid, text), public.withdraw_cancel_request(uuid), public.admin_decide_cancel_request(uuid, boolean, text), public.admin_member_counts() from public, anon;
grant execute on function public.request_membership_cancel(uuid, text), public.withdraw_cancel_request(uuid), public.admin_decide_cancel_request(uuid, boolean, text), public.admin_member_counts() to authenticated;
