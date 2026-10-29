// DEVELOPMENT ONLY — completes a checkout without taking money.
// Refuses to run unless ALLOW_TEST_PAYMENTS=true, and never alongside a live
// Stripe key. Everything it creates is flagged is_test / provider 'dev_test',
// labelled TEST in the app and excluded from revenue reporting.
import { adminClient, corsHeaders, dbErrorCode, json, readCheckoutBody, startCheckout, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const enabled = Deno.env.get('ALLOW_TEST_PAYMENTS') === 'true';
  const liveKey = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_live');
  if (!enabled || liveKey) return json(req, { error: 'test_payments_disabled' }, 403);

  const body = await readCheckoutBody(req);
  if (!body) return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);

  const { data: payment, error } = await startCheckout(supa, body, 'dev_test');
  if (error) return json(req, { error: dbErrorCode(error) }, 400);

  const { data: result, error: fulfilError } = await adminClient().rpc('fulfill_payment', {
    p_payment_id: payment.payment_id,
    p_provider: 'dev_test',
    p_provider_ref: `TEST-${crypto.randomUUID()}`,
    p_provider_event_id: null,
    p_amount_cents: payment.amount_cents,
    p_currency: payment.currency,
  });
  if (fulfilError || !result?.ok) return json(req, { error: dbErrorCode(fulfilError) }, 400);

  return json(req, { payment_id: payment.payment_id, membership_id: result.membership_id ?? null, booking_id: result.booking_id ?? null, is_test: true });
});
