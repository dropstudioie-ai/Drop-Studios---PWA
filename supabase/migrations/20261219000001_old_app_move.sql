-- Moving members from the old app, the same way every time:
--   • their classes left, for any class, valid until their old-app renew date (nothing renews automatically);
--   • a welcome email + a welcome pop-up asking them to add their photo, answer the survey and rate the new app.
alter table public.old_app_members add column if not exists moved_at timestamptz;
alter table public.old_app_members add column if not exists moved_user_id uuid references public.profiles(id) on delete set null;
alter table public.old_app_members add column if not exists moved_membership_id uuid references public.memberships(id) on delete set null;
alter table public.old_app_members add column if not exists welcome_done_at timestamptz;

-- What members think of the new app.
create table if not exists public.app_feedback (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 2000),
  context text not null default 'new_app',
  created_at timestamptz not null default now()
);
alter table public.app_feedback enable row level security;
revoke all on public.app_feedback from anon, authenticated;
grant select on public.app_feedback to authenticated;
drop policy if exists app_feedback_read on public.app_feedback;
create policy app_feedback_read on public.app_feedback for select to authenticated using (user_id = auth.uid() or public.is_admin());

/** Admin: move someone from the old app. p_classes = classes left (ignored for Unlimited); valid until the end of p_renew_on. */
create or replace function public._move_old_member(p_user_id uuid, p_classes int, p_renew_on date, p_plan_code text, p_old_plan text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pr public.profiles; o public.old_app_members; v_code text; v_plan public.membership_plans; r jsonb; mid uuid; v_now int; v_total int; pay public.payments;
begin
  select * into pr from public.profiles where id = p_user_id;
  if not found then perform public._fail('user_not_found'); end if;
  if p_renew_on is null or p_renew_on < public._local_today() then perform public._fail('invalid_renew_date'); end if;
  select * into o from public.old_app_members where lower(email) = lower(pr.email) limit 1;   -- emails are stored lower-case
  o.plan := coalesce(o.plan, p_old_plan);
  if o.moved_at is not null and o.moved_membership_id is not null and exists (select 1 from public.memberships where id = o.moved_membership_id and admin_status = 'valid')
  then perform public._fail('already_moved'); end if;

  -- Old plan → new plan name (every moved plan books any class).
  v_code := coalesce(p_plan_code, case
    when o.plan ilike '%unlimited%' then 'unlimited'
    when o.plan ilike '%full pass%' or o.plan ilike '%committed%' then 'multi-8'
    else 'multi-5' end);
  select * into v_plan from public.membership_plans where code = v_code;
  if not found then perform public._fail('plan_unavailable'); end if;
  if v_code <> 'unlimited' and (p_classes is null or p_classes < 1 or p_classes > 50) then perform public._fail('invalid_classes'); end if;

  if v_code = 'unlimited' then insert into public.plan_access (plan_id, user_id, granted_by) values (v_plan.id, p_user_id, auth.uid()) on conflict do nothing; end if;
  insert into public.payments (user_id, plan_id, plan_snapshot, amount_cents, currency, provider, is_test, status, idempotency_key, created_by, completed_at, provider_payment_ref)
  select p_user_id, v_plan.id, snap || jsonb_build_object('price_cents', 0, 'list_price_cents', snap -> 'price_cents'), 0, snap ->> 'currency', 'manual', false, 'succeeded',
         'old-app-move-' || gen_random_uuid(), auth.uid(), now(),
         format('Moved from old app: %s, %s, valid until %s', coalesce(o.plan, 'old app plan'),
           case when v_code = 'unlimited' then 'unlimited' else p_classes || ' classes left' end, to_char(p_renew_on, 'DD Mon YYYY'))
  from (select public._plan_snapshot(p_user_id, v_plan.id, null, false) snap) x
  returning * into pay;
  mid := public._create_membership(pay);
  if v_code <> 'unlimited' then
    select classes_remaining into v_now from public.memberships where id = mid;
    if p_classes <> v_now then
      update public.memberships set classes_remaining = p_classes where id = mid;
      insert into public.credit_transactions (membership_id, user_id, delta, balance_after, kind, actor_id, reason)
      values (mid, p_user_id, p_classes - v_now, p_classes, case when p_classes > v_now then 'admin_grant' else 'admin_revoke' end::public.ledger_kind, auth.uid(), format('Old app balance was %s classes', p_classes));
    end if;
    v_total := p_classes;
  end if;
  -- Valid until the end of the renew date: start the pack so its usual length ends then.
  update public.memberships
  set activated_at = ((p_renew_on - v_plan.validity_days)::timestamp + time '12:00') at time zone 'Europe/Dublin',
      classes_total = coalesce(v_total, classes_total)
  where id = mid;
  perform public._recompute_expiry(mid);

  -- Members who joined the old app after the export get a record too, so the welcome pop-up finds them.
  insert into public.old_app_members (email, full_name, plan, status, exported_on, moved_at, moved_user_id, moved_membership_id)
  values (lower(pr.email), pr.full_name, o.plan, 'ACTIVE', public._local_today(), now(), p_user_id, mid)
  on conflict (email) do update set moved_at = now(), moved_user_id = p_user_id, moved_membership_id = mid, welcome_done_at = null;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (p_user_id, 'moved_welcome', jsonb_build_object('plan_name', v_plan.name, 'classes', case when v_code = 'unlimited' then null else p_classes end,
    'valid_until', p_renew_on, 'old_plan', o.plan), 'moved_welcome:' || mid)
  on conflict (dedupe_key) do nothing;
  perform public._audit('old_app_member_moved', 'profile', p_user_id::text,
    jsonb_build_object('membership_id', mid, 'plan', v_code, 'classes', p_classes, 'renew_on', p_renew_on, 'old_plan', o.plan));
  return jsonb_build_object('membership_id', mid, 'plan', v_plan.name, 'expires_at', (select expires_at from public.memberships where id = mid));
end;
$$;
revoke all on function public._move_old_member(uuid, int, date, text, text) from public, anon, authenticated;

create or replace function public.admin_move_old_member(p_user_id uuid, p_classes int, p_renew_on date, p_plan_code text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return public._move_old_member(p_user_id, p_classes, p_renew_on, p_plan_code);
end;
$$;

-- Moves queued by email for people who haven't signed up yet: applied the moment they create their account.
create table if not exists public.old_app_pending_moves (
  email text primary key,
  classes int, renew_on date not null, plan_code text, old_plan text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  applied_at timestamptz, applied_user_id uuid references public.profiles(id) on delete set null, error text
);
alter table public.old_app_pending_moves enable row level security;
revoke all on public.old_app_pending_moves from anon, authenticated;
grant select on public.old_app_pending_moves to authenticated;
drop policy if exists pending_moves_admin on public.old_app_pending_moves;
create policy pending_moves_admin on public.old_app_pending_moves for select to authenticated using (public.is_admin());

/** Admin: move by email. If they have an account it happens now, otherwise as soon as they sign up. */
create or replace function public.admin_queue_move(p_email text, p_classes int, p_renew_on date, p_plan_code text default null, p_old_plan text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid;
begin
  perform public._require_admin();
  if coalesce(btrim(p_email), '') = '' then perform public._fail('invalid_email'); end if;
  select id into v_uid from public.profiles where lower(email) = lower(btrim(p_email)) limit 1;
  if v_uid is not null then return jsonb_build_object('moved', true) || public._move_old_member(v_uid, p_classes, p_renew_on, p_plan_code, p_old_plan); end if;
  if p_renew_on is null or p_renew_on < public._local_today() then perform public._fail('invalid_renew_date'); end if;
  insert into public.old_app_pending_moves (email, classes, renew_on, plan_code, old_plan, created_by)
  values (lower(btrim(p_email)), p_classes, p_renew_on, p_plan_code, p_old_plan, auth.uid())
  on conflict (email) do update set classes = excluded.classes, renew_on = excluded.renew_on, plan_code = excluded.plan_code,
    old_plan = excluded.old_plan, created_by = excluded.created_by, created_at = now(), applied_at = null, error = null;
  perform public._audit('old_app_move_queued', 'email', lower(btrim(p_email)), jsonb_build_object('classes', p_classes, 'renew_on', p_renew_on));
  return jsonb_build_object('moved', false, 'queued', true);
end;
$$;

create or replace function public._apply_pending_move()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.old_app_pending_moves;
begin
  select * into q from public.old_app_pending_moves where email = lower(new.email) and applied_at is null;
  if not found then return new; end if;
  begin
    perform public._move_old_member(new.id, q.classes, greatest(q.renew_on, public._local_today()), q.plan_code, q.old_plan);
    update public.old_app_pending_moves set applied_at = now(), applied_user_id = new.id where email = q.email;
  exception when others then
    update public.old_app_pending_moves set error = sqlerrm where email = q.email;   -- never block a sign-up
  end;
  return new;
end;
$$;
drop trigger if exists apply_pending_move on public.profiles;
create trigger apply_pending_move after insert on public.profiles for each row execute function public._apply_pending_move();

/** Member: their welcome checklist after moving (null once done or if they didn't move). */
create or replace function public.my_welcome()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.old_app_members; m public.memberships;
begin
  if auth.uid() is null then return null; end if;
  select * into o from public.old_app_members where moved_user_id = auth.uid() and moved_at is not null and welcome_done_at is null limit 1;
  if not found then return null; end if;
  select * into m from public.memberships where id = o.moved_membership_id;
  return jsonb_build_object(
    'plan_name', m.plan_name, 'classes', m.classes_remaining, 'unlimited', m.classes_total >= 900, 'expires_at', m.expires_at,
    'has_photo', (select avatar_path is not null from public.profiles where id = auth.uid()),
    'survey', public.my_survey(),
    'rated', exists (select 1 from public.app_feedback where user_id = auth.uid() and context = 'new_app'));
end;
$$;

create or replace function public.welcome_done()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.old_app_members set welcome_done_at = now() where moved_user_id = auth.uid() and welcome_done_at is null;
$$;

create or replace function public.submit_app_feedback(p_rating int, p_comment text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform public._fail('invalid_rating'); end if;
  insert into public.app_feedback (user_id, rating, comment) values (auth.uid(), p_rating, nullif(btrim(coalesce(p_comment, '')), ''));
end;
$$;

revoke all on function public.admin_queue_move(text, int, date, text, text) from public, anon;
grant execute on function public.admin_queue_move(text, int, date, text, text) to authenticated;
revoke all on function public.admin_move_old_member(uuid, int, date, text), public.my_welcome(), public.welcome_done(), public.submit_app_feedback(int, text) from public, anon;
grant execute on function public.admin_move_old_member(uuid, int, date, text), public.my_welcome(), public.welcome_done(), public.submit_app_feedback(int, text) to authenticated;
