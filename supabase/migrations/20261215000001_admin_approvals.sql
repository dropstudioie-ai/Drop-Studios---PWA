-- Everything waiting for an admin decision, counted in one call (shown as a pop-up when an admin opens the app).
-- Money items (payments to review, refunds to send) are only counted for admins with finance access.
create or replace function public.admin_approvals()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_fin boolean;
begin
  perform public._require_admin();
  v_fin := public.can_view_finance();
  return jsonb_build_object(
    'workshops', (select count(*) from public.studio_events where status = 'pending'),
    'time_off', (select count(*) from public.instructor_time_off where status = 'pending' and ends_on >= public._local_today()),
    'rentals', (select count(*) from public.rental_bookings where status = 'pending_approval' and starts_at > now()),
    'rental_blocks', (select count(distinct title) from public.rental_blocks
                      where confirmed_at is null and confirm_by is not null and starts_at > now()),
    'rental_blocks_by', (select min(confirm_by) from public.rental_blocks
                         where confirmed_at is null and confirm_by is not null and starts_at > now()),
    'dm_drafts', (select count(*) from public.assistant_messages where status = 'draft'),
    'comment_drafts', (select count(*) from public.assistant_comments where reply_status = 'draft' and reply_text is not null),
    'questions', (select count(*) from public.assistant_guidance where status = 'open'),
    'payments_to_review', case when v_fin then (select count(*) from public.payments where review_reason is not null) else 0 end,
    'refunds', case when v_fin then (select count(*) from public.ticket_choices where status = 'refund') else 0 end
  );
end;
$$;
revoke all on function public.admin_approvals() from public, anon;
grant execute on function public.admin_approvals() to authenticated;
