-- Drop Studios — an email receipt for every membership payment (first payment,
-- each monthly payment and sales recorded at the desk). Runs at commit time so
-- the month of a monthly membership is known. One receipt per payment.
create or replace function public._queue_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  per record;
begin
  if new.status <> 'succeeded' or new.kind <> 'membership' or new.amount_cents <= 0 or new.is_test then
    return null;
  end if;
  select sp.period_index, s.total_periods, s.next_billing_on, sp.credits_issued
  into per
  from public.subscription_periods sp join public.member_subscriptions s on s.id = sp.subscription_id
  where sp.payment_id = new.id;

  insert into public.notification_outbox (user_id, kind, payload, dedupe_key)
  values (new.user_id, 'payment_receipt', jsonb_build_object(
    'receipt_no', upper(left(replace(new.id::text, '-', ''), 10)),
    'plan_name', new.plan_snapshot ->> 'plan_name',
    'amount_cents', new.amount_cents,
    'currency', new.currency,
    'paid_at', coalesce(new.completed_at, now()),
    'provider', new.provider,
    'classes', coalesce(per.credits_issued, (new.plan_snapshot ->> 'class_count')::int),
    'month', per.period_index + 1,
    'of', per.total_periods,
    'next_billing_on', per.next_billing_on
  ), 'receipt:' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
end;
$$;

create constraint trigger payments_receipt
  after insert or update of status on public.payments
  deferrable initially deferred
  for each row execute function public._queue_payment_receipt();

revoke execute on function public._queue_payment_receipt() from public, anon, authenticated;
