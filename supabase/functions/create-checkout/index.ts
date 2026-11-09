// Starts a real Square checkout (payment link) for a membership plan, a
// workshop ticket or a Drop In class. The price comes from the database
// (create_checkout / create_ticket_checkout RPC), never from the client.
import { adminClient, corsHeaders, dbErrorCode, json, readCheckoutBody, startCheckout, userClient } from '../_shared/http.ts';
import { paymentLinkRequest, SQUARE_VERSION, squareBaseUrl } from '../_shared/square.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const accessToken = Deno.env.get('SQUARE_ACCESS_TOKEN');
  const locationId = Deno.env.get('SQUARE_LOCATION_ID');
  const siteUrl = Deno.env.get('SITE_URL');
  if (!accessToken || !locationId || !siteUrl) return json(req, { error: 'payments_not_configured' }, 503);

  const body = await readCheckoutBody(req);
  if (!body) return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);

  const { data: payment, error } = await startCheckout(supa, body, 'square');
  if (error) return json(req, { error: dbErrorCode(error) }, 400);
  if (payment.status === 'succeeded') return json(req, { payment_id: payment.payment_id, status: 'succeeded' });
  if (payment.status !== 'pending') return json(req, { error: 'payment_not_pending' }, 409);

  // The idempotency key is derived from our payment id, so a retry gets the
  // same Square link back: one payment record can never be paid twice.
  const res = await fetch(`${squareBaseUrl(Deno.env.get('SQUARE_ENVIRONMENT'))}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(paymentLinkRequest(payment, {
      locationId,
      siteUrl,
      buyerEmail: auth.user.email,
      kind: body.kind === 'ticket' ? (payment.kind === 'drop_in' ? 'drop_in' : 'ticket') : 'membership',
      supportEmail: Deno.env.get('SUPPORT_EMAIL'),
    })),
  });
  const result = await res.json().catch(() => null);
  const link = result?.payment_link;
  if (!res.ok || !link?.url || !link?.order_id) {
    console.error('Square payment link failed', res.status, JSON.stringify(result?.errors ?? result).slice(0, 500));
    return json(req, { error: 'payment_provider_error' }, 502);
  }

  // The webhook finds this payment again through the Square order id.
  // Sandbox payments are flagged as tests so they never count as revenue.
  const sandbox = Deno.env.get('SQUARE_ENVIRONMENT') !== 'production';
  if (payment.provider_session_id !== link.order_id || (sandbox && !payment.is_test)) {
    const { error: saveError } = await adminClient()
      .from('payments')
      .update({ provider_session_id: link.order_id, ...(sandbox ? { is_test: true } : {}) })
      .eq('id', payment.payment_id)
      .eq('status', 'pending');
    if (saveError) {
      console.error('could not save Square order id', saveError.message);
      return json(req, { error: 'server_error' }, 500);
    }
  }

  return json(req, { url: link.url, payment_id: payment.payment_id });
});
