// Admins refund a payment from the app (members can't). Square processes the
// refund; its refund webhook then records it in the audit log and marks a full
// refund on the payment.
import { adminClient, corsHeaders, dbErrorCode, json, userClient } from '../_shared/http.ts';
import { refundPayment, squareConfig, squarePaymentIdFor } from '../_shared/squareApi.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => null) as { payment_id?: string; amount_cents?: number; reason?: string } | null;
  if (typeof body?.payment_id !== 'string' || !body.reason?.trim()) return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);
  // Admin check and refundable check happen in the database.
  const { data: pay, error } = await supa.rpc('admin_can_refund', { p_payment_id: body.payment_id });
  if (error) return json(req, { error: dbErrorCode(error) }, 400);

  const amount = Math.round(body.amount_cents ?? pay.amount_cents);
  if (!(amount > 0 && amount <= pay.amount_cents)) return json(req, { error: 'invalid_amount' }, 400);

  const cfg = squareConfig();
  if (!cfg) return json(req, { error: 'payments_not_configured' }, 503);
  const squarePaymentId = pay.provider_payment_id ?? await squarePaymentIdFor(cfg, pay.provider_payment_ref);
  if (!squarePaymentId) return json(req, { error: 'payment_not_found_at_provider' }, 404);
  if (!pay.provider_payment_id) await adminClient().from('payments').update({ provider_payment_id: squarePaymentId }).eq('id', pay.payment_id);

  const r = await refundPayment(cfg, { paymentId: pay.payment_id, squarePaymentId, amountCents: amount, currency: pay.currency, reason: body.reason });
  if (!r.ok) return json(req, { error: 'refund_failed' }, 502);
  await adminClient().from('audit_log').insert({
    action: 'refund_requested', entity_type: 'payment', entity_id: pay.payment_id, actor_id: auth.user.id,
    details: { amount_cents: amount, reason: body.reason, square_refund: r.body.refund?.id, status: r.body.refund?.status },
  });
  return json(req, { ok: true, status: r.body.refund?.status ?? 'PENDING' });
});
