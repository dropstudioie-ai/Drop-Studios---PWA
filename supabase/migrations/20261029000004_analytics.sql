-- Drop Studios — admin reporting
-- Only real (non-test) succeeded payments count as revenue. Metrics that can't
-- be computed from the data return null (shown as "No data yet"), not 0.

create or replace function public.admin_analytics(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz text := (public._settings()).timezone;
  v_start timestamptz := (p_from::timestamp at time zone v_tz);
  v_end timestamptz := ((p_to + 1)::timestamp at time zone v_tz);
  v_revenue bigint;
  v_sales int;
  v_attended int;
  v_unmarked int;
  v_result jsonb;
begin
  perform public._require_admin();
  if p_to < p_from then perform public._fail('invalid_date_range'); end if;

  select coalesce(sum(amount_cents), 0), count(*) into v_revenue, v_sales
  from public.payments
  where status = 'succeeded' and not is_test and completed_at >= v_start and completed_at < v_end;

  select count(*) filter (where b.status = 'attended'),
         count(*) filter (where b.status = 'booked')
    into v_attended, v_unmarked
  from public.bookings b
  join public.class_sessions s on s.id = b.session_id
  left join public.memberships m on m.id = b.membership_id
  where s.starts_at >= v_start and s.starts_at < v_end and s.starts_at < now()
    and coalesce(m.is_test, false) = false;

  v_result := jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'revenue_cents', v_revenue,
    'sales', v_sales,
    'test_payments_excluded', (
      select count(*) from public.payments
      where status = 'succeeded' and is_test and completed_at >= v_start and completed_at < v_end
    ),

    'sales_by_plan', coalesce((
      select jsonb_agg(row_to_json(x) order by x.revenue_cents desc)
      from (
        select pu.plan_name, pu.plan_code, count(*) as sales, sum(p.amount_cents) as revenue_cents
        from public.payments p join public.membership_purchases pu on pu.payment_id = p.id
        where p.status = 'succeeded' and not p.is_test and p.completed_at >= v_start and p.completed_at < v_end
        group by pu.plan_name, pu.plan_code
      ) x
    ), '[]'),

    'intro_conversion', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'intro_customers', count(*),
        'converted', count(*) filter (where converted),
        'rate', round(count(*) filter (where converted)::numeric / count(*), 4)
      ) end
      from (
        select i.user_id, exists (
          select 1 from public.membership_purchases later
          where later.user_id = i.user_id and not later.is_test and not later.first_time_only
            and later.purchased_at > i.purchased_at
        ) as converted
        from public.membership_purchases i
        where i.first_time_only and not i.is_test
          and i.purchased_at >= v_start and i.purchased_at < v_end
      ) intro
    ),

    -- Finished = expired or all classes used. Usage is only meaningful then.
    'membership_usage', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'finished_memberships', count(*),
        'avg_classes_used', round(avg(classes_total - classes_remaining), 2),
        'avg_classes_available', round(avg(classes_total), 2),
        'expired_with_unused_classes', count(*) filter (where classes_remaining > 0),
        'repeat_purchase_rate', round(count(*) filter (where repurchased)::numeric / count(*), 4)
      ) end
      from (
        select m.*, exists (
          select 1 from public.membership_purchases nxt
          where nxt.user_id = m.user_id and not nxt.is_test and nxt.purchased_at > m.created_at
        ) as repurchased
        from public.memberships m
        join public.membership_purchases pu on pu.id = m.purchase_id
        where not m.is_test and m.admin_status = 'valid'
          and pu.purchased_at >= v_start and pu.purchased_at < v_end
          and (m.classes_remaining = 0 or m.expires_at <= now())
      ) finished
    ),

    'classes', (
      select case when count(*) = 0 then null else jsonb_build_object(
        'sessions', count(*),
        'capacity', sum(capacity),
        'booked', sum(booked_count),
        'occupancy_rate', round(sum(booked_count)::numeric / nullif(sum(capacity), 0), 4),
        'cancellations', (
          select count(*) from public.bookings b join public.class_sessions s2 on s2.id = b.session_id
          where b.status = 'cancelled' and s2.starts_at >= v_start and s2.starts_at < v_end
        ),
        'late_cancellations', (
          select count(*) from public.bookings b join public.class_sessions s2 on s2.id = b.session_id
          where b.status = 'late_cancelled' and s2.starts_at >= v_start and s2.starts_at < v_end
        ),
        'no_shows', (
          select count(*) from public.bookings b join public.class_sessions s2 on s2.id = b.session_id
          where b.status = 'no_show' and s2.starts_at >= v_start and s2.starts_at < v_end
        ),
        'cancelled_by_studio', count(*) filter (where status = 'cancelled')
      ) end
      from public.class_sessions
      where starts_at >= v_start and starts_at < v_end and starts_at < now()
    ),

    'attended_classes', v_attended,
    'unmarked_past_bookings', v_unmarked,
    'revenue_per_attended_class_cents',
      case when v_attended > 0 then round(v_revenue::numeric / v_attended) end
  );
  return v_result;
end;
$$;

revoke execute on function public.admin_analytics(date, date) from public, anon;
grant execute on function public.admin_analytics(date, date) to authenticated;
