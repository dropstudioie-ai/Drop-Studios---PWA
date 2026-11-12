-- Drop Studios — the admin "Today" page: what needs attention and this week's numbers.
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := coalesce((select timezone from public.app_settings limit 1), 'Europe/Dublin');
  v_today date := (now() at time zone v_tz)::date;
  v_week_start timestamptz := ((v_today - (extract(isodow from v_today)::int - 1))::timestamp at time zone v_tz);
begin
  perform public._require_admin();
  return jsonb_build_object(
    'payments_to_review', (select count(*) from public.payments where review_reason is not null),
    'unfinished_checkouts', (select count(*) from public.payments
                             where status = 'pending' and created_at > now() - interval '2 days'),
    'failed_monthly_payments', (select count(*) from public.member_subscriptions where status = 'past_due'),
    'ticket_refunds', (select count(*) from public.audit_log
                       where action = 'ticket_refund_required' and created_at > now() - interval '30 days'),
    'revenue_week_cents', (select coalesce(sum(amount_cents), 0) from public.payments
                           where status = 'succeeded' and not is_test and provider <> 'dev_test' and completed_at >= v_week_start),
    'payments_week', (select count(*) from public.payments
                      where status = 'succeeded' and not is_test and amount_cents > 0 and completed_at >= v_week_start),
    'new_members_week', (select count(*) from public.profiles where role = 'customer' and created_at >= v_week_start),
    'active_monthly', (select count(*) from public.member_subscriptions where status in ('active', 'past_due', 'cancel_scheduled')),
    'ending_monthly', (select count(*) from public.member_subscriptions
                       where status <> 'ended' and next_billing_on is null
                         and coalesce(cancel_effective_on, current_period_ends_on) <= v_today + 7),
    'bookings_today', (select count(*) from public.bookings b join public.class_sessions s on s.id = b.session_id
                       where b.status in ('booked', 'attended', 'no_show') and s.status = 'scheduled'
                         and (s.starts_at at time zone v_tz)::date = v_today)
  );
end;
$$;
revoke execute on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
