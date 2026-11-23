-- Studio hire invoice: one line per booked date (hours, rent, cleaning, DJ, promotion), the group/company, PAID.
-- Used by the PDF in the app (Payments & receipts) and attached to the "Studio booked" email.
-- Renters' business details, printed on their invoices.
create table if not exists public.billing_details (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  business_name text check (char_length(business_name) <= 120),
  address text check (char_length(address) <= 300),
  tax_number text check (char_length(tax_number) <= 40),
  billing_email text check (char_length(billing_email) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.billing_details enable row level security;
revoke all on public.billing_details from anon, authenticated;
grant select, insert, update, delete on public.billing_details to authenticated;
drop policy if exists billing_details_own on public.billing_details;
create policy billing_details_own on public.billing_details for all to authenticated
  using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

create or replace function public._rental_invoice(p_payment_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with cfg as (select dj_cents_per_hour, marketing_cents_per_week from public.rental_settings limit 1),
  b as (
    select rb.*, least(rb.addons_cents, round(rb.dj_minutes / 60.0 * (select dj_cents_per_hour from cfg))::int) as dj_cents
    from public.rental_bookings rb where rb.payment_id = p_payment_id
  )
  select jsonb_build_object(
    'invoice_no', 'DS-' || to_char(coalesce(p.completed_at, p.created_at) at time zone 'Europe/Dublin', 'YYMM') || '-' || upper(left(replace(p.id::text, '-', ''), 6)),
    'paid_at', coalesce(p.completed_at, p.created_at),
    'method', case p.provider when 'manual' then 'Paid at the studio' when 'square' then 'Card (Square)' else p.provider::text end,
    'status', p.status,
    'billed_name', pr.full_name, 'billed_email', coalesce(nullif(bd.billing_email, ''), pr.email), 'billed_phone', pr.phone,
    'company', coalesce(nullif(bd.business_name, ''), (select group_name from b where group_name is not null order by starts_at limit 1)),
    'address', nullif(bd.address, ''), 'tax_number', nullif(bd.tax_number, ''),
    'total_cents', p.amount_cents,
    'refund_cents', (select coalesce(sum(refund_cents), 0) from b),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'starts_at', b.starts_at, 'ends_at', b.ends_at, 'is_party', b.is_party, 'status', b.status,
        'hours', round(extract(epoch from (b.ends_at - b.starts_at)) / 3600.0, 2),
        'rent_cents', b.rent_cents, 'cleaning_cents', b.cleaning_cents,
        'dj_minutes', b.dj_minutes, 'dj_cents', b.dj_cents,
        'marketing_weeks', b.marketing_weeks, 'marketing_cents', b.addons_cents - b.dj_cents,
        'total_cents', b.total_cents) order by b.starts_at) from b), '[]'::jsonb)
  )
  from public.payments p join public.profiles pr on pr.id = p.user_id
  left join public.billing_details bd on bd.user_id = p.user_id
  where p.id = p_payment_id and p.kind = 'rental';
$$;
revoke all on function public._rental_invoice(uuid) from public, anon, authenticated;

create or replace function public.my_receipts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(r order by r ->> 'paid_at' desc), '[]') from (
    select jsonb_build_object(
      'id', p.id,
      'receipt_no', upper(left(replace(p.id::text, '-', ''), 10)),
      'paid_at', coalesce(p.completed_at, p.created_at),
      'kind', p.kind,
      'description', case
        when p.kind::text = 'gift' then 'Gift card: ' || replace(p.plan_snapshot ->> 'plan_name', ' (gift)', '')
            || coalesce(' for ' || g.recipient_name, '')
        when p.kind = 'ticket' then 'Ticket: ' || coalesce(e.title, s.title, 'Special event')
        when p.kind = 'drop_in' then 'Drop In class: ' || coalesce(s.title, 'class')
        when p.kind = 'rental' then 'Studio hire'
        else p.plan_snapshot ->> 'plan_name' end,
      'class_date', s.starts_at,
      'month', sp.period_index + 1,
      'of', ms.total_periods,
      'invoice', case when p.kind = 'rental' then public._rental_invoice(p.id) end,
      'classes', case when p.kind = 'membership' then coalesce(sp.credits_issued, (p.plan_snapshot ->> 'class_count')::int) end,
      'amount_cents', p.amount_cents,
      'currency', p.currency,
      'method', case p.provider when 'manual' then 'Paid at the studio' when 'square' then 'Card (Square)' else p.provider::text end,
      'status', p.status,
      'gift_code', g.code
    ) r
    from public.payments p
    left join public.subscription_periods sp on sp.payment_id = p.id
    left join public.member_subscriptions ms on ms.id = sp.subscription_id
    left join public.class_sessions s on s.id = p.session_id
    left join lateral (select title from public.studio_events where session_id = p.session_id and status = 'published' limit 1) e on true
    left join public.gift_cards g on g.payment_id = p.id
    where p.user_id = auth.uid() and p.status in ('succeeded', 'refunded') and not p.is_test and p.amount_cents > 0
  ) x;
$function$;


-- The "Studio booked" email carries the invoice (attached as a PDF).
create or replace function public._confirm_rental(pay payments)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    values (pay.user_id, 'rental_confirmed', public._rental_payload(first_b) || jsonb_build_object('occurrences', n, 'paid_cents', pay.amount_cents,
      'access_code', (select access_code from public.rental_private limit 1), 'house_rules', (select house_rules from public.rental_settings limit 1), 'invoice', public._rental_invoice(pay.id)), 'rental_conf:' || pay.id)
    on conflict (dedupe_key) do nothing;
    perform public._rental_tell_owner('rental_booked', public._rental_payload(first_b) || jsonb_build_object('occurrences', n, 'paid_cents', pay.amount_cents), 'rental_booked:' || pay.id);
  end if;
  return jsonb_build_object('ok', true, 'rental_bookings', n, 'lost', lost);
end;
$function$;

