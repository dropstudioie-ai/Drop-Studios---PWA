// A renter (or an admin) cancels a studio rental. The database decides whether it's refunded
// (7+ days before, or an admin's choice); the refund for that booking is then sent to Square.
import { adminClient, corsHeaders, dbErrorCode, json, userClient } from '../_shared/http.ts';
import { refundPayment, squareConfig, squarePaymentIdFor } from '../_shared/squareApi.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => null) as { booking_id?: string; refund?: boolean } | null;
  if (typeof body?.booking_id !== 'string') return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);
  const { data: res, error } = await supa.rpc('cancel_rental', { p_booking_id: body.booking_id, p_refund: typeof body.refund === 'boolean' ? body.refund : null });
  if (error) return json(req, { error: dbErrorCode(error) }, 400);
  if (!(res.refund_cents > 0)) return json(req, { ok: true, refund_cents: 0 });

  // Refund this booking's share of the payment.
  let ok = false;
  const cfg = squareConfig();
  if (cfg && res.provider === 'square') {
    const squarePaymentId = res.provider_payment_id ?? await squarePaymentIdFor(cfg, res.provider_payment_ref);
    if (squarePaymentId) {
      const r = await refundPayment(cfg, { paymentId: `${res.payment_id}-${body.booking_id}`, squarePaymentId, amountCents: res.refund_cents, currency: res.currency ?? 'EUR', reason: 'Studio rental cancelled' });
      ok = r.ok;
    }
  } else if (res.provider === 'dev_test') ok = true;
  await adminClient().rpc('record_rental_refund', { p_booking_id: body.booking_id, p_ok: ok });
  return json(req, { ok: true, refund_cents: res.refund_cents, refunded: ok });
});
