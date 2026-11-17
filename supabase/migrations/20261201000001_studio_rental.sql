-- Studio rental: people rent the Drop room by the hour (or every week at the same time, paid month by month).
-- Rules: never during a Drop class, never double-booked (enforced by the database), 30-minute steps (min 1h),
-- first-time renters / outside 07:00–24:00 / more than 12 weeks ahead need the owner's approval before paying,
-- reschedule up to 24h before, refund up to 7 days before. Monthly series keep next month's slots until the last
-- day of the current month; unpaid on the 1st, they're released.

alter type public.payment_kind add value if not exists 'rental';

alter table public.payments drop constraint if exists payments_kind_target;
alter table public.payments add constraint payments_kind_target check (
  ((kind::text in ('membership', 'gift')) and plan_id is not null and session_id is null)
  or ((kind::text in ('ticket', 'drop_in')) and session_id is not null and plan_id is null)
  or (kind::text = 'rental' and plan_id is null and session_id is null));

create table if not exists public.rental_settings (
  id boolean primary key default true check (id),
  weekday_peak_cents int not null default 4500,     -- Mon–Fri 18:00–22:00
  weekday_cents int not null default 2500,          -- Mon–Fri other times
  saturday_cents int not null default 4500,
  saturday_offer_cents int not null default 2500,   -- Saturday 17:00–20:00
  sunday_cents int not null default 4500,
  party_cents int not null default 4500,            -- parties, any day and time
  cleaning_fee_cents int not null default 3000,     -- parties, on top of the total
  open_from_min int not null default 420,           -- 07:00
  open_to_min int not null default 1440,            -- 24:00
  max_weeks_ahead int not null default 12,
  hold_minutes int not null default 30,             -- time to pay after starting checkout
  approval_hold_hours int not null default 48,      -- time to pay after the owner approves
  updated_at timestamptz not null default now()
);
insert into public.rental_settings (id) values (true) on conflict do nothing;

create table if not exists public.rental_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday int not null check (weekday between 1 and 7),   -- ISO: 1 = Monday
  start_local time not null,
  minutes int not null check (minutes >= 60 and minutes % 30 = 0),
  is_party boolean not null default false,
  purpose text, group_name text, people int,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table if not exists public.rental_bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  series_id uuid references public.rental_series(id) on delete set null,
  month_key date,                                   -- first day of the month this occurrence belongs to (series)
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  during tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  is_party boolean not null default false,
  purpose text, group_name text, people int,
  status text not null check (status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed', 'cancelled', 'declined', 'expired', 'released')),
  approval_reasons text[] not null default '{}',
  rent_cents int not null, cleaning_cents int not null default 0, total_cents int not null,
  payment_id uuid references public.payments(id) on delete set null,
  hold_expires_at timestamptz,
  admin_note text,
  decided_by uuid references public.profiles(id) on delete set null,
  cancelled_at timestamptz,
  refund_cents int, refund_status text check (refund_status in ('pending', 'refunded', 'failed')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- The room can never be booked twice (anything not cancelled/declined/expired/released holds its time).
  constraint rental_no_double_booking exclude using gist (during with &&)
    where (status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed'))
);
create index if not exists rental_bookings_user on public.rental_bookings (user_id, starts_at desc);
create index if not exists rental_bookings_upcoming on public.rental_bookings (starts_at) where status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed');

alter table public.rental_settings enable row level security;
alter table public.rental_series enable row level security;
alter table public.rental_bookings enable row level security;
drop policy if exists rental_settings_read on public.rental_settings;
create policy rental_settings_read on public.rental_settings for select to anon, authenticated using (true);
drop policy if exists rental_settings_admin on public.rental_settings;
create policy rental_settings_admin on public.rental_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists rental_series_read on public.rental_series;
create policy rental_series_read on public.rental_series for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists rental_bookings_read on public.rental_bookings;
create policy rental_bookings_read on public.rental_bookings for select to authenticated using (user_id = auth.uid() or public.is_admin());
grant select on public.rental_settings, public.rental_series, public.rental_bookings to authenticated;
grant select on public.rental_settings to anon;
grant update on public.rental_settings to authenticated;

-- ---------- Prices ----------

-- Price of a booking, half hour by half hour at each slot's own rate (Dublin time).
create or replace function public.rental_price(p_start timestamptz, p_end timestamptz, p_party boolean)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  t timestamptz := p_start;
  loc timestamp;
  m int; dow int; rate int;
  rent int := 0;
  by_rate jsonb := '{}';
begin
  while t < p_end loop
    loc := t at time zone 'Europe/Dublin';
    m := extract(hour from loc)::int * 60 + extract(minute from loc)::int;
    dow := extract(isodow from loc)::int;
    rate := case
      when p_party then cfg.party_cents
      when dow <= 5 then case when m >= 1080 and m < 1320 then cfg.weekday_peak_cents else cfg.weekday_cents end
      when dow = 6 then case when m >= 1020 and m < 1200 then cfg.saturday_offer_cents else cfg.saturday_cents end
      else cfg.sunday_cents end;
    rent := rent + rate / 2;
    by_rate := jsonb_set(by_rate, array[rate::text], to_jsonb(coalesce((by_rate ->> rate::text)::int, 0) + 30));
    t := t + interval '30 minutes';
  end loop;
  return jsonb_build_object('rent_cents', rent, 'cleaning_cents', case when p_party then cfg.cleaning_fee_cents else 0 end,
    'total_cents', rent + case when p_party then cfg.cleaning_fee_cents else 0 end,
    'minutes', (extract(epoch from p_end - p_start) / 60)::int,
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('rate_cents', k::int, 'minutes', v::int) order by k::int), '[]') from jsonb_each_text(by_rate) e(k, v)));
end;
$$;
grant execute on function public.rental_price(timestamptz, timestamptz, boolean) to anon, authenticated;

-- ---------- Checks ----------

-- Validates a time slot; fails if it can't be booked, returns why the owner must approve it (if anything).
create or replace function public._rental_check(p_user uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  ls timestamp := p_start at time zone 'Europe/Dublin';
  le timestamp := p_end at time zone 'Europe/Dublin';
  reasons text[] := '{}';
begin
  if p_end <= p_start then perform public._fail('rental_invalid_time'); end if;
  if p_start <= now() then perform public._fail('rental_in_past'); end if;
  if extract(minute from ls)::int % 30 <> 0 or extract(second from ls) <> 0 or (extract(epoch from p_end - p_start)::int % 1800) <> 0 then
    perform public._fail('rental_half_hours');
  end if;
  if p_end - p_start < interval '1 hour' then perform public._fail('rental_min_hour'); end if;
  if p_end - p_start > interval '16 hours' then perform public._fail('rental_too_long'); end if;
  -- Never at the same time as a Drop class.
  if exists (select 1 from public.class_sessions s where s.status = 'scheduled' and s.starts_at < p_end and s.ends_at > p_start) then
    perform public._fail('rental_class_clash');
  end if;
  if exists (select 1 from public.rental_bookings b where b.during && tstzrange(p_start, p_end, '[)') and b.id is distinct from p_ignore
             and b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed')) then
    perform public._fail('rental_unavailable');
  end if;
  if not exists (select 1 from public.rental_bookings where user_id = p_user and status = 'confirmed') then reasons := array_append(reasons, 'first_time'); end if;
  if ls::date <> (le - interval '1 microsecond')::date
     or extract(hour from ls) * 60 + extract(minute from ls) < cfg.open_from_min
     or (le::date = ls::date and extract(hour from le) * 60 + extract(minute from le) > cfg.open_to_min) then
    reasons := array_append(reasons, 'outside_hours');
  end if;
  if p_start > now() + make_interval(weeks => cfg.max_weeks_ahead) then reasons := array_append(reasons, 'beyond_12_weeks'); end if;
  return reasons;
end;
$$;

-- Busy times (Drop classes and rentals, no names) so the booking page can show what's free.
create or replace function public.rental_busy(p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]') from (
    select jsonb_build_object('starts_at', s.starts_at, 'ends_at', s.ends_at, 'what', 'Drop class') x
    from public.class_sessions s where s.status = 'scheduled' and s.starts_at < p_to and s.ends_at > p_from
    union all
    select jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'what', 'Booked')
    from public.rental_bookings b where b.status in ('pending_approval', 'awaiting_payment', 'held', 'confirmed') and b.starts_at < p_to and b.ends_at > p_from
  ) q where p_to - p_from <= interval '62 days';
$$;
grant execute on function public.rental_busy(timestamptz, timestamptz) to anon, authenticated;

-- What a booking would cost and whether it needs the owner's approval (without booking it).
create or replace function public.rental_quote(p_start timestamptz, p_end timestamptz, p_party boolean)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare reasons text[];
begin
  reasons := public._rental_check(auth.uid(), p_start, p_end);
  if auth.uid() is null then reasons := array_append(array_remove(reasons, 'first_time'), 'first_time'); end if;
  return public.rental_price(p_start, p_end, p_party) || jsonb_build_object('approval_reasons', to_jsonb(reasons));
end;
$$;
grant execute on function public.rental_quote(timestamptz, timestamptz, boolean) to anon, authenticated;

-- ---------- Booking ----------

create or replace function public._rental_tell_owner(p_kind text, p_payload jsonb, p_key text)
returns void language sql security definer set search_path = public, pg_temp as $$
  select public._assistant_notify_owner(p_kind, p_payload, p_key);
$$;

create or replace function public._rental_payload(b public.rental_bookings)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('booking_id', b.id, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'is_party', b.is_party,
    'purpose', b.purpose, 'group_name', b.group_name, 'people', b.people, 'total_cents', b.total_cents,
    'renter', (select full_name from public.profiles where id = b.user_id), 'renter_email', (select email from public.profiles where id = b.user_id),
    'renter_phone', (select phone from public.profiles where id = b.user_id), 'series', b.series_id is not null, 'reasons', to_jsonb(b.approval_reasons));
$$;

-- Ask for a booking (one-off, or the same time every week: this month now, next month's slots kept for you).
create or replace function public.request_rental(p_start timestamptz, p_end timestamptz, p_party boolean, p_purpose text,
  p_group_name text, p_people int, p_recurring boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  v_len interval := p_end - p_start;
  v_month date := date_trunc('month', p_start at time zone 'Europe/Dublin')::date;
  v_series uuid;
  v_reasons text[] := '{}';
  r text[];
  t timestamptz;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_price jsonb;
  v_status text;
  v_total int := 0;
  b public.rental_bookings;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if length(coalesce(p_purpose, '')) > 300 or length(coalesce(p_group_name, '')) > 80 then perform public._fail('too_long'); end if;
  perform 1 from public.profiles where id = v_uid for update;   -- one request at a time per person

  -- Every occurrence must be free; approval is needed if any of them needs it.
  t := p_start;
  loop
    r := public._rental_check(v_uid, t, t + v_len);
    select array_agg(distinct x) into v_reasons from unnest(v_reasons || r) x;
    exit when not p_recurring;
    t := t + interval '7 days';
    exit when date_trunc('month', t at time zone 'Europe/Dublin')::date <> v_month;
  end loop;
  v_reasons := coalesce(v_reasons, '{}');
  v_status := case when cardinality(v_reasons) > 0 then 'pending_approval' else 'awaiting_payment' end;

  if p_recurring then
    insert into public.rental_series (user_id, weekday, start_local, minutes, is_party, purpose, group_name, people)
    values (v_uid, extract(isodow from p_start at time zone 'Europe/Dublin')::int, (p_start at time zone 'Europe/Dublin')::time,
            (extract(epoch from v_len) / 60)::int, p_party, nullif(btrim(p_purpose), ''), nullif(btrim(p_group_name), ''), p_people)
    returning id into v_series;
  end if;

  t := p_start;
  loop
    v_price := public.rental_price(t, t + v_len, p_party);
    insert into public.rental_bookings (user_id, series_id, month_key, starts_at, ends_at, is_party, purpose, group_name, people, status,
      approval_reasons, rent_cents, cleaning_cents, total_cents, hold_expires_at)
    values (v_uid, v_series, case when p_recurring then v_month end, t, t + v_len, p_party, nullif(btrim(p_purpose), ''), nullif(btrim(p_group_name), ''), p_people,
      v_status, v_reasons, (v_price ->> 'rent_cents')::int, (v_price ->> 'cleaning_cents')::int, (v_price ->> 'total_cents')::int,
      case when v_status = 'awaiting_payment' then now() + make_interval(mins => cfg.hold_minutes) end)
    returning id into v_id;
    v_ids := v_ids || v_id;
    v_total := v_total + (v_price ->> 'total_cents')::int;
    exit when not p_recurring;
    t := t + interval '7 days';
    exit when date_trunc('month', t at time zone 'Europe/Dublin')::date <> v_month;
  end loop;

  -- A monthly booking also keeps next month's slots (until the end of this month) when they're free.
  if p_recurring then perform public._rental_hold_next_month(v_series, v_month); end if;

  if v_status = 'pending_approval' then
    select * into b from public.rental_bookings where id = v_ids[1];
    perform public._rental_tell_owner('rental_requested', public._rental_payload(b) || jsonb_build_object('occurrences', cardinality(v_ids), 'month_total_cents', v_total),
      'rental_req:' || b.id);
  end if;
  perform public._audit('rental_requested', 'rental_booking', v_ids[1]::text, jsonb_build_object('count', cardinality(v_ids), 'reasons', v_reasons, 'series', v_series));
  return jsonb_build_object('booking_ids', to_jsonb(v_ids), 'needs_approval', v_status = 'pending_approval', 'reasons', to_jsonb(v_reasons),
    'total_cents', v_total, 'series_id', v_series);
end;
$$;
revoke all on function public.request_rental(timestamptz, timestamptz, boolean, text, text, int, boolean) from public, anon;
grant execute on function public.request_rental(timestamptz, timestamptz, boolean, text, text, int, boolean) to authenticated;

-- Keep a series' slots for the month after p_month, until the last day of p_month (skips slots that are taken or clash).
create or replace function public._rental_hold_next_month(p_series uuid, p_month date)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.rental_series;
  v_next date := (p_month + interval '1 month')::date;
  v_until timestamptz := ((p_month + interval '1 month')::timestamp at time zone 'Europe/Dublin');
  d date; t timestamptz; v_price jsonb; n int := 0;
begin
  select * into s from public.rental_series where id = p_series and status = 'active';
  if not found then return 0; end if;
  if exists (select 1 from public.rental_bookings where series_id = s.id and month_key = v_next and status in ('held', 'awaiting_payment', 'confirmed', 'pending_approval')) then return 0; end if;
  d := v_next + ((s.weekday - extract(isodow from v_next)::int + 7) % 7);
  while d < (v_next + interval '1 month')::date loop
    t := (d + s.start_local) at time zone 'Europe/Dublin';
    begin
      if not exists (select 1 from public.class_sessions c where c.status = 'scheduled' and c.starts_at < t + make_interval(mins => s.minutes) and c.ends_at > t) then
        v_price := public.rental_price(t, t + make_interval(mins => s.minutes), s.is_party);
        insert into public.rental_bookings (user_id, series_id, month_key, starts_at, ends_at, is_party, purpose, group_name, people, status,
          rent_cents, cleaning_cents, total_cents, hold_expires_at)
        values (s.user_id, s.id, v_next, t, t + make_interval(mins => s.minutes), s.is_party, s.purpose, s.group_name, s.people, 'held',
          (v_price ->> 'rent_cents')::int, (v_price ->> 'cleaning_cents')::int, (v_price ->> 'total_cents')::int, v_until);
        n := n + 1;
      end if;
    exception when exclusion_violation then null;   -- someone else already has that slot
    end;
    d := d + 7;
  end loop;
  return n;
end;
$$;
revoke all on function public._rental_hold_next_month(uuid, date) from public, anon, authenticated;

-- The owner approves or declines a request (for a series: all of its waiting dates).
create or replace function public.admin_decide_rental(p_booking_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  b public.rental_bookings;
  n int;
begin
  perform public._require_admin();
  select * into b from public.rental_bookings where id = p_booking_id for update;
  if not found then perform public._fail('not_found'); end if;
  if b.status <> 'pending_approval' then perform public._fail('rental_not_pending'); end if;
  if p_approve then
    update public.rental_bookings set status = 'awaiting_payment', hold_expires_at = now() + make_interval(hours => cfg.approval_hold_hours),
      decided_by = auth.uid(), admin_note = nullif(btrim(p_note), '')
    where status = 'pending_approval' and (id = b.id or (b.series_id is not null and series_id = b.series_id));
  else
    update public.rental_bookings set status = 'declined', decided_by = auth.uid(), admin_note = nullif(btrim(p_note), ''), hold_expires_at = null
    where status in ('pending_approval', 'held') and (id = b.id or (b.series_id is not null and series_id = b.series_id));
    if b.series_id is not null then update public.rental_series set status = 'ended' where id = b.series_id; end if;
  end if;
  get diagnostics n = row_count;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (b.user_id, case when p_approve then 'rental_approved' else 'rental_declined' end,
    public._rental_payload(b) || jsonb_build_object('note', nullif(btrim(p_note), ''), 'pay_within_hours', cfg.approval_hold_hours, 'occurrences', n),
    'rental_decided:' || b.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit(case when p_approve then 'rental_approved' else 'rental_declined' end, 'rental_booking', b.id::text, jsonb_build_object('count', n));
  return jsonb_build_object('ok', true, 'bookings', n);
end;
$$;
revoke all on function public.admin_decide_rental(uuid, boolean, text) from public, anon;
grant execute on function public.admin_decide_rental(uuid, boolean, text) to authenticated;

-- ---------- Paying ----------

create or replace function public.create_rental_checkout(p_booking_ids uuid[], p_idempotency_key text, p_provider public.payment_provider)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  cfg public.rental_settings := (select r from public.rental_settings r limit 1);
  pay public.payments;
  v_total int; v_n int; v_first timestamptz;
begin
  if v_uid is null then perform public._fail('not_authenticated'); end if;
  if p_provider not in ('square', 'dev_test') then perform public._fail('invalid_provider'); end if;
  if coalesce(length(p_idempotency_key), 0) < 8 then perform public._fail('invalid_idempotency_key'); end if;
  select * into pay from public.payments where user_id = v_uid and idempotency_key = p_idempotency_key;
  if not found then
    perform 1 from public.rental_bookings where id = any (p_booking_ids) for update;
    select count(*), sum(total_cents), min(starts_at) into v_n, v_total, v_first from public.rental_bookings
    where id = any (p_booking_ids) and user_id = v_uid and status in ('awaiting_payment', 'held')
      and (hold_expires_at is null or hold_expires_at > now());
    if v_n is distinct from cardinality(p_booking_ids) or v_n = 0 then perform public._fail('rental_not_payable'); end if;
    insert into public.payments (user_id, plan_snapshot, amount_cents, currency, provider, is_test, idempotency_key, created_by, kind)
    values (v_uid, jsonb_build_object('plan_name', 'Studio rental' || case when v_n > 1 then format(' (%s bookings)', v_n) else '' end,
      'class_count', v_n, 'billing_interval', 'one_off'), v_total, 'EUR', p_provider, p_provider = 'dev_test', p_idempotency_key, v_uid, 'rental')
    returning * into pay;
    -- Paying keeps the slot a little longer (held next-month slots keep their month-end deadline).
    update public.rental_bookings set payment_id = pay.id,
      hold_expires_at = case when status = 'awaiting_payment' then greatest(hold_expires_at, now() + make_interval(mins => cfg.hold_minutes)) else hold_expires_at end
    where id = any (p_booking_ids);
  end if;
  return jsonb_build_object('payment_id', pay.id, 'status', pay.status, 'amount_cents', pay.amount_cents, 'currency', pay.currency,
    'plan_name', pay.plan_snapshot ->> 'plan_name', 'class_count', (pay.plan_snapshot ->> 'class_count')::int, 'provider', pay.provider,
    'provider_session_id', pay.provider_session_id, 'is_test', pay.is_test, 'superseded', '[]'::jsonb, 'plan_id', null,
    'billing_interval', 'one_off', 'commitment_months', null, 'kind', 'rental');
end;
$$;
revoke all on function public.create_rental_checkout(uuid[], text, public.payment_provider) from public, anon;
grant execute on function public.create_rental_checkout(uuid[], text, public.payment_provider) to authenticated;

-- Paid: the bookings are confirmed (and a monthly series keeps next month's slots).
create or replace function public._confirm_rental(pay public.payments)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b record; n int := 0; lost int := 0; v_series uuid; v_month date; first_b public.rental_bookings;
begin
  for b in select * from public.rental_bookings where payment_id = pay.id order by starts_at loop
    begin
      update public.rental_bookings set status = 'confirmed', hold_expires_at = null where id = b.id and status <> 'confirmed';
      n := n + 1;
      v_series := coalesce(v_series, b.series_id); v_month := greatest(v_month, b.month_key);
    exception when exclusion_violation then
      lost := lost + 1;   -- the hold ran out and someone else took the slot: the owner sorts it out
    end;
  end loop;
  if lost > 0 then
    update public.payments set review_reason = 'rental_slot_lost' where id = pay.id;
    perform public._rental_tell_owner('rental_problem', jsonb_build_object('payment_id', pay.id, 'lost', lost,
      'renter', (select full_name from public.profiles where id = pay.user_id)), 'rental_lost:' || pay.id);
  end if;
  if v_series is not null and v_month is not null then perform public._rental_hold_next_month(v_series, v_month); end if;
  select * into first_b from public.rental_bookings where payment_id = pay.id order by starts_at limit 1;
  if found then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (pay.user_id, 'rental_confirmed', public._rental_payload(first_b) || jsonb_build_object('occurrences', n, 'paid_cents', pay.amount_cents), 'rental_conf:' || pay.id)
    on conflict (dedupe_key) do nothing;
    perform public._rental_tell_owner('rental_booked', public._rental_payload(first_b) || jsonb_build_object('occurrences', n, 'paid_cents', pay.amount_cents), 'rental_booked:' || pay.id);
  end if;
  return jsonb_build_object('ok', true, 'rental_bookings', n, 'lost', lost);
end;
$$;

-- ---------- Changing and cancelling ----------

-- Move a booking (same length) up to 24h before it starts, to a free time that doesn't need approval and costs no more.
create or replace function public.reschedule_rental(p_booking_id uuid, p_new_start timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.rental_bookings; r text[]; v_price jsonb; v_end timestamptz;
begin
  select * into b from public.rental_bookings where id = p_booking_id for update;
  if not found or (b.user_id <> auth.uid() and not public.is_admin()) then perform public._fail('not_found'); end if;
  if b.status not in ('confirmed', 'awaiting_payment', 'held') then perform public._fail('rental_not_active'); end if;
  if now() > b.starts_at - interval '24 hours' and not public.is_admin() then perform public._fail('rental_reschedule_too_late'); end if;
  v_end := p_new_start + (b.ends_at - b.starts_at);
  r := array_remove(public._rental_check(b.user_id, p_new_start, v_end, b.id), 'first_time');
  if cardinality(r) > 0 and not public.is_admin() then perform public._fail('rental_needs_approval'); end if;
  v_price := public.rental_price(p_new_start, v_end, b.is_party);
  if (v_price ->> 'total_cents')::int > b.total_cents and b.status = 'confirmed' and not public.is_admin() then perform public._fail('rental_reschedule_price_higher'); end if;
  update public.rental_bookings set starts_at = p_new_start, ends_at = v_end,
    rent_cents = case when status = 'confirmed' then rent_cents else (v_price ->> 'rent_cents')::int end,
    total_cents = case when status = 'confirmed' then total_cents else (v_price ->> 'total_cents')::int end
  where id = b.id;
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (b.user_id, 'rental_rescheduled', public._rental_payload(b) || jsonb_build_object('new_starts_at', p_new_start, 'new_ends_at', v_end), 'rental_resch:' || b.id || ':' || extract(epoch from now())::bigint)
  on conflict (dedupe_key) do nothing;
  perform public._rental_tell_owner('rental_rescheduled', public._rental_payload(b) || jsonb_build_object('new_starts_at', p_new_start, 'new_ends_at', v_end, 'owner', true),
    'rental_resch_owner:' || b.id || ':' || extract(epoch from now())::bigint);
  perform public._audit('rental_rescheduled', 'rental_booking', b.id::text, jsonb_build_object('from', b.starts_at, 'to', p_new_start));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reschedule_rental(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_rental(uuid, timestamptz) to authenticated;

-- Cancel: a full refund up to 7 days before (the rental-cancel function sends it to Square). Admins can always refund.
create or replace function public.cancel_rental(p_booking_id uuid, p_refund boolean default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b public.rental_bookings; pay public.payments; v_refund int := 0;
begin
  select * into b from public.rental_bookings where id = p_booking_id for update;
  if not found or (b.user_id <> auth.uid() and not public.is_admin()) then perform public._fail('not_found'); end if;
  if b.status not in ('confirmed', 'awaiting_payment', 'held', 'pending_approval') then perform public._fail('rental_not_active'); end if;
  if b.status = 'confirmed' and b.payment_id is not null then
    select * into pay from public.payments where id = b.payment_id;
    if (public.is_admin() and coalesce(p_refund, now() <= b.starts_at - interval '7 days')) or (not public.is_admin() and now() <= b.starts_at - interval '7 days') then
      v_refund := b.total_cents;
    end if;
  end if;
  update public.rental_bookings set status = 'cancelled', cancelled_at = now(), hold_expires_at = null,
    refund_cents = nullif(v_refund, 0), refund_status = case when v_refund > 0 then 'pending' end
  where id = b.id;
  perform public._rental_tell_owner('rental_cancelled', public._rental_payload(b) || jsonb_build_object('refund_cents', v_refund, 'owner', true), 'rental_cancel_owner:' || b.id);
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (b.user_id, 'rental_cancelled', public._rental_payload(b) || jsonb_build_object('refund_cents', v_refund), 'rental_cancel:' || b.id)
  on conflict (dedupe_key) do nothing;
  perform public._audit('rental_cancelled', 'rental_booking', b.id::text, jsonb_build_object('refund_cents', v_refund));
  return jsonb_build_object('ok', true, 'refund_cents', v_refund, 'payment_id', pay.id, 'provider', pay.provider,
    'provider_payment_id', pay.provider_payment_id, 'provider_payment_ref', pay.provider_payment_ref, 'currency', pay.currency);
end;
$$;
revoke all on function public.cancel_rental(uuid, boolean) from public, anon;
grant execute on function public.cancel_rental(uuid, boolean) to authenticated;

create or replace function public.record_rental_refund(p_booking_id uuid, p_ok boolean)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.rental_bookings set refund_status = case when p_ok then 'refunded' else 'failed' end where id = p_booking_id and refund_status = 'pending';
$$;
revoke all on function public.record_rental_refund(uuid, boolean) from public, anon, authenticated;
grant execute on function public.record_rental_refund(uuid, boolean) to service_role;

-- ---------- Every 15 minutes: holds, reminders, reports ----------

create or replace function public.rental_report_payload(p_kind text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := public._local_date(now());
  f timestamptz; t timestamptz; pf timestamptz; pt timestamptz;
begin
  if p_kind = 'daily' then
    f := (today + 1)::timestamp at time zone 'Europe/Dublin'; t := (today + 2)::timestamp at time zone 'Europe/Dublin';
    pf := today::timestamp at time zone 'Europe/Dublin'; pt := f;
  elsif p_kind = 'weekly' then
    f := today::timestamp at time zone 'Europe/Dublin'; t := (today + 7)::timestamp at time zone 'Europe/Dublin';
    pf := (today - 7)::timestamp at time zone 'Europe/Dublin'; pt := f;
  else
    f := date_trunc('month', today)::timestamp at time zone 'Europe/Dublin'; t := (date_trunc('month', today) + interval '1 month')::timestamp at time zone 'Europe/Dublin';
    pf := (date_trunc('month', today) - interval '1 month')::timestamp at time zone 'Europe/Dublin'; pt := f;
  end if;
  return jsonb_build_object('kind', p_kind, 'from', f, 'to', t, 'past_from', pf, 'past_to', pt,
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'ends_at', b.ends_at, 'who', coalesce(b.group_name, p.full_name),
        'party', b.is_party, 'status', b.status) order by b.starts_at), '[]')
      from public.rental_bookings b join public.profiles p on p.id = b.user_id
      where b.status in ('confirmed', 'awaiting_payment', 'held', 'pending_approval') and b.starts_at >= f and b.starts_at < t),
    'upcoming_hours', (select coalesce(sum(extract(epoch from ends_at - starts_at)) / 3600, 0) from public.rental_bookings where status = 'confirmed' and starts_at >= f and starts_at < t),
    'past_hours', (select coalesce(sum(extract(epoch from ends_at - starts_at)) / 3600, 0) from public.rental_bookings where status = 'confirmed' and starts_at >= pf and starts_at < pt),
    'past_revenue_cents', (select coalesce(sum(amount_cents), 0) from public.payments where kind::text = 'rental' and status = 'succeeded' and not is_test and completed_at >= pf and completed_at < pt),
    'pending_approval', (select count(distinct coalesce(series_id, id)) from public.rental_bookings where status = 'pending_approval'),
    'unpaid_next_month', (select count(distinct series_id) from public.rental_bookings where status = 'held'),
    'new_requests', (select count(*) from public.rental_bookings where created_at >= pf and created_at < pt and series_id is null)
      + (select count(*) from public.rental_series where created_at >= pf and created_at < pt));
end;
$$;
revoke all on function public.rental_report_payload(text) from public, anon, authenticated;

create or replace function public.rental_jobs()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  now_local timestamp := now() at time zone 'Europe/Dublin';
  today date := now_local::date;
  n_exp int; n_rel int; r record; bk public.rental_bookings;
begin
  -- Unpaid checkouts and approvals that ran out of time free the slot.
  update public.rental_bookings set status = 'expired' where status = 'awaiting_payment' and hold_expires_at < now();
  get diagnostics n_exp = row_count;
  -- Next month's slots not paid by the end of this month are released for others.
  for r in
    with rel as (update public.rental_bookings set status = 'released' where status = 'held' and hold_expires_at < now() returning *)
    select user_id, series_id, min(starts_at) first_at, count(*) n from rel group by user_id, series_id
  loop
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    values (r.user_id, 'rental_released', jsonb_build_object('first_at', r.first_at, 'count', r.n), 'rental_rel:' || r.series_id || ':' || today)
    on conflict (dedupe_key) do nothing;
  end loop;
  get diagnostics n_rel = row_count;

  -- Last week of the month: remind series renters to pay next month.
  if (today + 7) >= (date_trunc('month', today) + interval '1 month')::date then
    insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
    select b.user_id, 'rental_next_month_due', jsonb_build_object('count', count(*), 'total_cents', sum(b.total_cents), 'first_at', min(b.starts_at),
        'deadline', max(b.hold_expires_at), 'group_name', max(b.group_name)), 'rental_due:' || b.series_id || ':' || max(b.month_key)
    from public.rental_bookings b where b.status = 'held' and b.payment_id is null
    group by b.user_id, b.series_id
    on conflict (dedupe_key) do nothing;
  end if;

  -- Reminders: the renter a day before; the owner a day before and 2 hours before.
  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  select b.user_id, 'rental_reminder', public._rental_payload(b), 'rental_rem24:' || b.id
  from public.rental_bookings b where b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + interval '24 hours'
  on conflict (dedupe_key) do nothing;
  for bk in select b.* from public.rental_bookings b where b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + interval '24 hours' loop
    perform public._rental_tell_owner('rental_owner_reminder', public._rental_payload(bk) || jsonb_build_object('when', 'tomorrow'), 'rental_own24:' || bk.id);
    if bk.starts_at <= now() + interval '2 hours' then
      perform public._rental_tell_owner('rental_owner_reminder', public._rental_payload(bk) || jsonb_build_object('when', 'in 2 hours'), 'rental_own2:' || bk.id);
    end if;
  end loop;

  -- Thamires' rental reports for the owner: daily at 21:00, weekly on Monday 08:00, monthly on the 1st at 08:00.
  if extract(hour from now_local) >= 21 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('daily'), 'rental_rep_d:' || today);
  end if;
  if extract(isodow from now_local) = 1 and extract(hour from now_local) >= 8 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('weekly'), 'rental_rep_w:' || today);
  end if;
  if extract(day from now_local) = 1 and extract(hour from now_local) >= 8 then
    perform public._rental_tell_owner('rental_report', public.rental_report_payload('monthly'), 'rental_rep_m:' || today);
  end if;
  return jsonb_build_object('expired', n_exp, 'released', n_rel);
end;
$$;
revoke all on function public.rental_jobs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule('drop-rental-jobs') from cron.job where jobname = 'drop-rental-jobs'$q$;
    execute $q$select cron.schedule('drop-rental-jobs', '*/15 * * * *', 'select public.rental_jobs()')$q$;
  end if;
end $$;

-- ---------- Admin overview ----------

create or replace function public.admin_rentals(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select coalesce(jsonb_agg(public._rental_payload(b) || jsonb_build_object('status', b.status, 'series_id', b.series_id, 'month_key', b.month_key,
      'hold_expires_at', b.hold_expires_at, 'refund_cents', b.refund_cents, 'refund_status', b.refund_status, 'paid', b.payment_id is not null and b.status = 'confirmed',
      'created_at', b.created_at) order by b.starts_at), '[]')
    from public.rental_bookings b where b.starts_at < p_to and b.ends_at > p_from);
end;
$$;
revoke all on function public.admin_rentals(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_rentals(timestamptz, timestamptz) to authenticated;

-- Payments for rentals confirm the bookings.
create or replace function public.fulfill_payment(p_payment_id uuid, p_provider public.payment_provider, p_provider_ref text,
  p_provider_event_id text, p_amount_cents integer, p_currency text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  pay public.payments;
  v_membership_id uuid;
  v_was_cancelled boolean;
  v_sub jsonb;
begin
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then perform public._fail('payment_not_found'); end if;

  if pay.status = 'succeeded' then
    if pay.kind::text = 'rental' then
      return jsonb_build_object('ok', true, 'duplicate', true);
    end if;
    if pay.kind::text = 'gift' then
      return jsonb_build_object('ok', true, 'gift_card_id', (select id from public.gift_cards where payment_id = pay.id), 'duplicate', true);
    end if;
    if pay.kind <> 'membership' then
      return jsonb_build_object('ok', true, 'booking_id', pay.booking_id, 'duplicate', true);
    end if;
    select m.id into v_membership_id
    from public.membership_purchases pu join public.memberships m on m.purchase_id = pu.id
    where pu.payment_id = pay.id;
    return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', true,
      'subscription_id', (select id from public.member_subscriptions where initial_payment_id = pay.id));
  end if;

  if pay.provider <> p_provider then perform public._fail('provider_mismatch'); end if;
  if pay.status not in ('pending', 'cancelled', 'failed') then perform public._fail('payment_not_fulfillable', pay.status::text); end if;

  if p_amount_cents is distinct from pay.amount_cents or upper(p_currency) is distinct from upper(pay.currency) then
    update public.payments set status = 'failed',
      failure_reason = format('amount mismatch: expected %s %s, got %s %s', pay.amount_cents, pay.currency, p_amount_cents, p_currency)
    where id = pay.id;
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  v_was_cancelled := pay.status in ('cancelled', 'failed');

  update public.payments
  set status = 'succeeded', completed_at = now(), provider_payment_ref = p_provider_ref,
      provider_event_id = p_provider_event_id, failure_reason = null,
      review_reason = case when v_was_cancelled then 'paid_after_cancel' end
  where id = pay.id
  returning * into pay;

  if v_was_cancelled then
    perform public._audit('payment_review_required', 'payment', pay.id::text,
      jsonb_build_object('reason', 'paid_after_cancel', 'user_id', pay.user_id, 'amount_cents', pay.amount_cents,
                         'plan_name', pay.plan_snapshot ->> 'plan_name'));
    insert into public.notification_outbox (user_id, kind, payload)
    select a.id, 'payment_review', jsonb_build_object(
      'member_name', (select full_name from public.profiles where id = pay.user_id),
      'plan_name', pay.plan_snapshot ->> 'plan_name', 'amount_cents', pay.amount_cents, 'user_id', pay.user_id)
    from public.profiles a where a.role = 'admin';
  end if;

  if pay.kind::text = 'gift' then
    return public._activate_gift_card(pay) || jsonb_build_object('duplicate', false);
  end if;

  if pay.kind::text = 'rental' then
    return public._confirm_rental(pay) || jsonb_build_object('duplicate', false);
  end if;

  if pay.kind <> 'membership' then
    return public._confirm_ticket(pay) || jsonb_build_object('duplicate', false);
  end if;

  if pay.plan_snapshot ->> 'billing_interval' = 'monthly' then
    v_sub := public._start_subscription(pay);
    return v_sub || jsonb_build_object('ok', true, 'duplicate', false);
  end if;

  v_membership_id := public._create_membership(pay);
  return jsonb_build_object('ok', true, 'membership_id', v_membership_id, 'duplicate', false);
end;
$fn$;

-- Thamires knows about renting the studio.
create or replace function public.assistant_knowledge()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'today', to_char(now() at time zone 'Europe/Dublin', 'FMDay DD FMMonth YYYY'),
    'studio', jsonb_build_object('name', 'Drop Studios', 'address', '13 Sackville Place, Dublin 1, D01 (city centre, near O''Connell Street)',
      'website', 'https://www.dropstudios.ie', 'email', 'dropstudioie@gmail.com'),
    'policies', (select jsonb_build_object(
        'booking_window_days', s.booking_window_days,
        'free_cancellation_minutes_before', s.cancellation_cutoff_minutes,
        'bring_a_friend', 'First-time customers buying a Drop In can bring a friend free (2 spots for the price of one).',
        'first_class', 'New members can book their first class without a profile photo; we take it at reception.',
        'payments', 'Card, Apple Pay and Google Pay, online through Square.',
        'studio_rental', 'The Drop room can be rented by the hour at https://www.dropstudios.ie/rent : 100 m² room with laminated wooden floor, floor-to-ceiling mirrors, RGB LED lights, wall fan and industrial air fans, black light; outside the room a bathroom with shower, a fully fitted kitchen and a spacious reception. Prices: Mon–Fri €25/h, but €45/h from 18:00 to 22:00; Saturday €45/h except €25/h from 17:00 to 20:00; Sunday €45/h. Parties €45/h any time plus a €30 cleaning fee. Minimum 1 hour, 30-minute steps. Regular hours 07:00–24:00. Book and pay in the app (first-time renters are confirmed by the studio first). Weekly bookings at the same time can be booked month by month. Reschedule up to 24h before; full refund if cancelled at least 7 days before. Never during Drop classes. For anything unusual (outside 07:00–24:00, more than 12 weeks ahead, special setups) the studio confirms.',
        'gift_cards', 'Digital gift cards for any Drop pack (monthly plans are gifted as one month). Buy at https://www.dropstudios.ie/gift: add a personal message and choose the day it is emailed, or print it and give it in person. Redeem in the app at https://www.dropstudios.ie/gift/redeem or at reception. Valid for 5 years.',
        'app', 'The Drop app works in any phone browser and can be added to the home screen (no app store): https://www.dropstudios.ie/app')
      from public.app_settings s limit 1),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'label', p.display_label, 'price_eur', p.price_cents / 100.0,
        'classes', p.class_count, 'first_time_only', p.first_time_only, 'link', 'https://www.dropstudios.ie/checkout/' || p.code) order by p.sort_order), '[]')
      from public.membership_plans p where p.is_active and p.visibility = 'public'),
    'styles', (select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'level', d.level, 'description', d.description,
        'what_to_wear', d.what_to_wear, 'what_to_bring', d.what_to_bring, 'first_class', d.first_class,
        'drop_in_eur', d.drop_in_price_cents / 100.0, 'page', 'https://www.dropstudios.ie/classes/' || d.slug) order by d.sort_order), '[]')
      from public.dance_styles d where d.is_active),
    'next_14_days', (select coalesce(jsonb_agg(jsonb_build_object(
        'when', to_char(s.starts_at at time zone 'Europe/Dublin', 'Dy DD Mon HH24:MI'),
        'class', s.title, 'style', d.name, 'instructor', i.full_name,
        'availability', public._availability(s.capacity, s.booked_count),
        'special', (select e.title from public.studio_events e where e.session_id = s.id and e.status = 'published' limit 1),
        'book', 'https://www.dropstudios.ie/timetable?class=' || s.id) order by s.starts_at), '[]')
      from public.class_sessions s left join public.dance_styles d on d.id = s.style_id left join public.instructors i on i.id = s.instructor_id
      where s.status = 'scheduled' and s.starts_at > now() and s.starts_at < now() + interval '14 days'),
    'notes', (select notes from public.assistant_settings),
    'owner_guidance', (select coalesce(jsonb_agg(jsonb_build_object('question', g.question, 'answer', g.answer) order by g.answered_at desc), '[]')
      from (select question, answer, answered_at from public.assistant_guidance where status = 'answered' order by answered_at desc limit 60) g));
$fn$;
revoke all on function public.assistant_knowledge() from public, anon, authenticated;
grant execute on function public.assistant_knowledge() to service_role;
