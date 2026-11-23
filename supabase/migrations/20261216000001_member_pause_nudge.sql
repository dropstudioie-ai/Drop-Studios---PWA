-- A personal request from the studio to one member to schedule a pause (e.g. agreed in person), shown when they open
-- the app until a pause starting on/after the agreed date exists. The member picks the end date themselves.
create table if not exists public.member_nudges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'schedule_pause' check (kind in ('schedule_pause')),
  pause_from date not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists member_nudges_open on public.member_nudges (user_id) where done_at is null;
alter table public.member_nudges enable row level security;
revoke all on public.member_nudges from anon, authenticated;

/** The open request for this member, with the membership to pause. Marks it done once a matching pause exists. */
create or replace function public.my_nudge()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  n public.member_nudges;
  m public.memberships;
begin
  if auth.uid() is null then return null; end if;
  for n in select * from public.member_nudges where user_id = auth.uid() and done_at is null order by created_at loop
    if exists (select 1 from public.membership_pauses p where p.user_id = n.user_id and not p.is_cancelled and p.starts_on >= n.pause_from) then
      update public.member_nudges set done_at = now() where id = n.id;
      continue;
    end if;
    select * into m from public.memberships
    where user_id = n.user_id and admin_status = 'valid' and expires_at > now() and classes_remaining > 0
      and public._local_date(expires_at) > n.pause_from
    order by expires_at desc limit 1;
    if not found then continue; end if;   -- nothing that can be paused from that date
    return jsonb_build_object('id', n.id, 'kind', n.kind, 'pause_from', n.pause_from, 'note', n.note,
      'membership_id', m.id, 'classes_remaining', m.classes_remaining, 'expires_at', m.expires_at);
  end loop;
  return null;
end;
$$;

/** Studio side: ask a member to schedule a pause from a date. */
create or replace function public.admin_request_pause(p_user_id uuid, p_from date, p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public._require_admin();
  insert into public.member_nudges (user_id, pause_from, note, created_by) values (p_user_id, p_from, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into v_id;
  perform public._audit('pause_requested', 'profile', p_user_id::text, jsonb_build_object('from', p_from, 'note', p_note));
  return v_id;
end;
$$;

revoke all on function public.my_nudge(), public.admin_request_pause(uuid, date, text) from public, anon;
grant execute on function public.my_nudge(), public.admin_request_pause(uuid, date, text) to authenticated;

-- While such a request is open, the member can't start a pause before the agreed date (admins still can).
create or replace function public._pause_respects_nudge()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from date;
begin
  if public.is_admin() then return new; end if;
  select min(pause_from) into v_from from public.member_nudges where user_id = new.user_id and done_at is null and kind = 'schedule_pause';
  if v_from is not null and new.starts_on < v_from then
    perform public._fail('pause_before_agreed_date', to_char(v_from, 'FMDay DD Mon'));
  end if;
  return new;
end;
$$;
drop trigger if exists pause_respects_nudge on public.membership_pauses;
create trigger pause_respects_nudge before insert on public.membership_pauses for each row execute function public._pause_respects_nudge();
