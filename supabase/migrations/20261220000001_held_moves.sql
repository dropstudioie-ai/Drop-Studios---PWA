-- Old-app members whose credits were "manually added" in Glofox only move with admin permission:
-- when they sign up their move is put on hold, the studio is told, and an admin approves (setting classes and date) or declines.
alter table public.old_app_pending_moves add column if not exists needs_approval boolean not null default false;
alter table public.old_app_pending_moves add column if not exists held_at timestamptz;
alter table public.old_app_pending_moves add column if not exists declined_at timestamptz;
alter table public.old_app_pending_moves alter column renew_on drop not null;

/** Admin: save a move that needs approval when they sign up (credits seen in Glofox, no promise). */
create or replace function public.admin_queue_held_move(p_email text, p_classes int, p_old_plan text default null, p_glofox_expiry date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid; v_email text := lower(btrim(p_email));
begin
  perform public._require_admin();
  if coalesce(v_email, '') = '' then perform public._fail('invalid_email'); end if;
  insert into public.old_app_pending_moves (email, classes, renew_on, old_plan, needs_approval, created_by)
  values (v_email, p_classes, p_glofox_expiry, p_old_plan, true, auth.uid())
  on conflict (email) do update set classes = excluded.classes, renew_on = excluded.renew_on, old_plan = excluded.old_plan,
    needs_approval = true, created_by = excluded.created_by, created_at = now(), applied_at = null, held_at = null, declined_at = null, error = null;
  select id into v_uid from public.profiles where lower(email) = v_email limit 1;
  if v_uid is not null then perform public._hold_pending_move(v_email, v_uid); end if;   -- already signed up: on hold now
  return jsonb_build_object('queued', true, 'held_now', v_uid is not null);
end;
$$;

create or replace function public._hold_pending_move(p_email text, p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.old_app_pending_moves;
begin
  update public.old_app_pending_moves set held_at = now(), applied_user_id = p_user where email = p_email and held_at is null returning * into q;
  if q.email is null then return; end if;
  perform public._assistant_notify_owner('old_app_move_held', jsonb_build_object('member', (select full_name from public.profiles where id = p_user),
    'email', p_email, 'user_id', p_user, 'classes', q.classes, 'old_plan', q.old_plan, 'glofox_expiry', q.renew_on), 'move_held:' || p_email);
end;
$$;

create or replace function public._apply_pending_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.old_app_pending_moves;
begin
  select * into q from public.old_app_pending_moves where email = lower(new.email) and applied_at is null and declined_at is null;
  if not found then return new; end if;
  begin
    if q.needs_approval then
      perform public._hold_pending_move(q.email, new.id);
    else
      perform public._move_old_member(new.id, q.classes, greatest(q.renew_on, public._local_today()), q.plan_code, q.old_plan);
      update public.old_app_pending_moves set applied_at = now(), applied_user_id = new.id where email = q.email;
    end if;
  exception when others then
    update public.old_app_pending_moves set error = sqlerrm where email = q.email;   -- never block a sign-up
  end;
  return new;
end;
$$;

/** Admin: approve a held move (classes + valid-until date of your choice) or decline it. */
create or replace function public.admin_decide_held_move(p_email text, p_approve boolean, p_classes int default null, p_renew_on date default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.old_app_pending_moves; r jsonb;
begin
  perform public._require_admin();
  select * into q from public.old_app_pending_moves where email = lower(btrim(p_email)) for update;
  if not found or q.held_at is null or q.applied_at is not null or q.declined_at is not null then perform public._fail('not_found'); end if;
  if not p_approve then
    update public.old_app_pending_moves set declined_at = now() where email = q.email;
    perform public._audit('old_app_move_declined', 'email', q.email, '{}'::jsonb);
    return jsonb_build_object('declined', true);
  end if;
  r := public._move_old_member(q.applied_user_id, coalesce(p_classes, q.classes), p_renew_on, q.plan_code, q.old_plan);
  update public.old_app_pending_moves set applied_at = now(), classes = coalesce(p_classes, q.classes), renew_on = p_renew_on where email = q.email;
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
    'refund_requests', case when v_fin then (select count(*) from public.ticket_choices where status = 'refund_requested') else 0 end,
    'held_moves', (select count(*) from public.old_app_pending_moves where held_at is not null and applied_at is null and declined_at is null)
  );
end;
$function$;


revoke all on function public._hold_pending_move(text, uuid) from public, anon, authenticated;
revoke all on function public.admin_queue_held_move(text, int, text, date), public.admin_decide_held_move(text, boolean, int, date) from public, anon;
grant execute on function public.admin_queue_held_move(text, int, text, date), public.admin_decide_held_move(text, boolean, int, date) to authenticated;
