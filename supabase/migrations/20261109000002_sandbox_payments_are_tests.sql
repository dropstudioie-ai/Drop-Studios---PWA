-- Drop Studios — payments made with Square's Sandbox are test payments.
--
-- is_test stays immutable, with one exception: create-checkout (service role)
-- may flag a still-pending payment as a test when Square runs in Sandbox, so
-- test purchases never count as revenue. A test payment can never become real.
create or replace function public.guard_payment_update()
returns trigger
language plpgsql
as $$
begin
  if old.amount_cents <> new.amount_cents
     or old.currency <> new.currency
     or old.plan_snapshot <> new.plan_snapshot
     or old.user_id <> new.user_id
     or (old.is_test <> new.is_test and not (old.status = 'pending' and new.status = 'pending' and new.is_test)) then
    raise exception 'immutable_record' using detail = 'payment terms cannot be changed';
  end if;
  if old.status = 'succeeded' and new.status not in ('succeeded', 'refunded') then
    raise exception 'immutable_record' using detail = 'succeeded payment cannot be reverted';
  end if;
  return new;
end;
$$;
