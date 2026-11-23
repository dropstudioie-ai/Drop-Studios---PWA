-- Quick in-app surveys for members (first one: "December plans").
-- A member is asked when they open the app. "Not now" asks again on their next visit; after a second
-- "Not now" they are never asked again. Answers are visible to admins only.

create table if not exists public.member_surveys (
  key text primary key,
  title text not null,
  starts_on date not null,
  ends_on date not null
);

create table if not exists public.survey_responses (
  survey_key text not null references public.member_surveys(key) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  declines int not null default 0,
  last_declined_at timestamptz,
  answer text check (answer in ('all_month', 'some_days', 'away_all', 'not_sure')),
  away_from date,
  away_to date,
  answered_at timestamptz,
  primary key (survey_key, user_id),
  check (away_to is null or away_from is null or away_to >= away_from)
);

alter table public.member_surveys enable row level security;
alter table public.survey_responses enable row level security;
revoke all on public.member_surveys, public.survey_responses from anon, authenticated;

insert into public.member_surveys (key, title, starts_on, ends_on)
values ('december-2026', 'December plans', date '2026-11-23', date '2026-12-06')
on conflict (key) do nothing;

/** The survey this member should be asked now, or null. */
create or replace function public.my_survey()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  s public.member_surveys;
begin
  if v_uid is null or public.is_staff() then return null; end if;
  select * into s from public.member_surveys sv
  where public._local_today() between sv.starts_on and sv.ends_on
    and not exists (
      select 1 from public.survey_responses r
      where r.survey_key = sv.key and r.user_id = v_uid and (r.answered_at is not null or r.declines >= 2)
    )
  order by sv.starts_on limit 1;
  if not found then return null; end if;
  return jsonb_build_object('key', s.key, 'title', s.title,
    'declines', coalesce((select declines from public.survey_responses where survey_key = s.key and user_id = v_uid), 0));
end;
$$;

create or replace function public.survey_decline(p_key text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  insert into public.survey_responses (survey_key, user_id, declines, last_declined_at)
  values (p_key, auth.uid(), 1, now())
  on conflict (survey_key, user_id) do update
    set declines = survey_responses.declines + 1, last_declined_at = now()
    where survey_responses.answered_at is null;
end;
$$;

create or replace function public.survey_answer(p_key text, p_answer text, p_from date default null, p_to date default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if p_answer not in ('all_month', 'some_days', 'away_all', 'not_sure') then perform public._fail('invalid_answer'); end if;
  if p_answer = 'some_days' and (p_from is null or p_to is null or p_to < p_from) then perform public._fail('invalid_pause_dates'); end if;
  insert into public.survey_responses (survey_key, user_id, answer, away_from, away_to, answered_at)
  values (p_key, auth.uid(), p_answer,
          case when p_answer = 'some_days' then p_from end, case when p_answer = 'some_days' then p_to end, now())
  on conflict (survey_key, user_id) do update
    set answer = excluded.answer, away_from = excluded.away_from, away_to = excluded.away_to, answered_at = now();
end;
$$;

/** Admin results: totals, each answer (with whether a pause is booked), and how many people are away each day. */
create or replace function public.admin_survey_results(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.member_surveys;
  v_month_start date;
  v_rows jsonb;
  v_days jsonb;
begin
  perform public._require_admin();
  select * into s from public.member_surveys where key = p_key;
  if not found then perform public._fail('not_found'); end if;
  v_month_start := date_trunc('month', s.ends_on + 25)::date; -- the month the survey asks about

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', r.user_id, 'name', p.full_name, 'answer', r.answer,
      'away_from', r.away_from, 'away_to', r.away_to, 'answered_at', r.answered_at, 'declines', r.declines,
      'paused', exists (
        select 1 from public.membership_pauses mp
        where mp.user_id = r.user_id and not mp.is_cancelled
          and mp.ends_on >= coalesce(r.away_from, v_month_start)
          and mp.starts_on <= coalesce(r.away_to, (v_month_start + interval '1 month - 1 day')::date)),
      'active_member', exists (
        select 1 from public.memberships m where m.user_id = r.user_id and m.admin_status = 'valid'
          and m.expires_at > now() and m.classes_remaining > 0)
    ) order by r.answered_at desc nulls last, p.full_name), '[]'::jsonb)
  into v_rows
  from public.survey_responses r join public.profiles p on p.id = r.user_id
  where r.survey_key = p_key;

  select jsonb_agg(jsonb_build_object('day', d::date,
      'away', (select count(*) from public.survey_responses r where r.survey_key = p_key and (
                 r.answer = 'away_all' or (r.answer = 'some_days' and d::date between r.away_from and r.away_to))))
    order by d)
  into v_days
  from generate_series(v_month_start, (v_month_start + interval '1 month - 1 day')::date, interval '1 day') d;

  return jsonb_build_object(
    'key', s.key, 'title', s.title, 'starts_on', s.starts_on, 'ends_on', s.ends_on, 'month', v_month_start,
    'answered', (select count(*) from public.survey_responses where survey_key = p_key and answered_at is not null),
    'declined', (select count(*) from public.survey_responses where survey_key = p_key and answered_at is null and declines >= 2),
    'counts', (select coalesce(jsonb_object_agg(answer, n), '{}'::jsonb) from (
      select answer, count(*) n from public.survey_responses where survey_key = p_key and answer is not null group by answer) c),
    'rows', v_rows, 'days', v_days);
end;
$$;

revoke all on function public.my_survey(), public.survey_decline(text), public.survey_answer(text, text, date, date), public.admin_survey_results(text) from public, anon;
grant execute on function public.my_survey(), public.survey_decline(text), public.survey_answer(text, text, date, date), public.admin_survey_results(text) to authenticated;
