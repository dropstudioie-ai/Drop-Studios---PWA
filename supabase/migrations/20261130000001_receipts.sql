-- Members can download a receipt for each of their payments in the app.
-- Same receipt numbers as the receipt emails (first 10 characters of the payment id).
create or replace function public.my_receipts()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
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
        else p.plan_snapshot ->> 'plan_name' end,
      'class_date', s.starts_at,
      'month', sp.period_index + 1,
      'of', ms.total_periods,
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
$$;
revoke all on function public.my_receipts() from public, anon;
grant execute on function public.my_receipts() to authenticated;
