-- Cancel requests: a reason (required) and a 1–5 star rating of their time at Drop.
alter table public.cancel_requests add column if not exists rating int check (rating between 1 and 5);

drop function if exists public.request_membership_cancel(uuid, text);
create or replace function public.request_membership_cancel(p_subscription_id uuid, p_reason text, p_rating int)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.member_subscriptions; v uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then perform public._fail('not_authenticated'); end if;
  if v_reason is null then perform public._fail('cancel_reason_required'); end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then perform public._fail('invalid_rating'); end if;
  select * into s from public.member_subscriptions where id = p_subscription_id and user_id = auth.uid();
  if not found then perform public._fail('not_found'); end if;
  if s.status not in ('active', 'past_due') then perform public._fail('cancel_not_possible'); end if;
  if exists (select 1 from public.cancel_requests where subscription_id = s.id and status = 'pending') then perform public._fail('cancel_already_requested'); end if;
  insert into public.cancel_requests (user_id, subscription_id, reason, rating) values (auth.uid(), s.id, v_reason, p_rating) returning id into v;
  perform public._audit('cancel_requested', 'subscription', s.id::text, jsonb_build_object('request_id', v, 'rating', p_rating));
  perform public._assistant_notify_owner('cancel_requested', jsonb_build_object('member', (select full_name from public.profiles where id = auth.uid()),
    'user_id', auth.uid(), 'plan', s.plan_snapshot ->> 'plan_name', 'reason', v_reason, 'rating', p_rating), 'cancel_req:' || v);
  return v;
end;
$$;
revoke all on function public.request_membership_cancel(uuid, text, int) from public, anon;
grant execute on function public.request_membership_cancel(uuid, text, int) to authenticated;
