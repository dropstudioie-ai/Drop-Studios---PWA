// Members cancel (or un-cancel) their monthly membership; admins can end one at
// the end of the current month. The rules live in the database functions; this
// only forwards the cancellation to Square once it's due.
import { adminClient, corsHeaders, dbErrorCode, json, userClient } from '../_shared/http.ts';
import { sendCancelIfDue, squareConfig, syncBillingIfNeeded } from '../_shared/squareApi.ts';

const RPC: Record<string, string> = {
  cancel: 'request_subscription_cancel',
  undo_cancel: 'undo_subscription_cancel',
  end_now: 'admin_end_subscription_now',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const body = await req.json().catch(() => null) as { action?: string; subscription_id?: string; reason?: string } | null;
  const fn = body?.action ? RPC[body.action] : undefined;
  if ((!fn && body?.action !== 'sync_billing') || typeof body?.subscription_id !== 'string') return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);

  // After a pause: tell Square the new payment day. Only the member or an
  // admin can see the subscription (row security), so this checks access.
  if (body.action === 'sync_billing') {
    const { data: mine } = await supa.from('member_subscriptions').select('id').eq('id', body.subscription_id).maybeSingle();
    if (!mine) return json(req, { error: 'subscription_not_found' }, 404);
    await syncBillingIfNeeded(adminClient(), squareConfig(), body.subscription_id);
    return json(req, { ok: true });
  }

  const args: Record<string, unknown> = { p_subscription_id: body.subscription_id };
  if (body.action === 'end_now') args.p_reason = body.reason ?? '';
  const { data, error } = await supa.rpc(fn!, args);
  if (error) return json(req, { error: dbErrorCode(error) }, 400);

  await sendCancelIfDue(adminClient(), squareConfig(), body.subscription_id, data?.send_provider_cancel);
  return json(req, data ?? { ok: true });
});
