// Starts a real Square checkout (payment link) for a membership plan, a
// workshop ticket or a Drop In class. The price comes from the database
// (create_checkout / create_ticket_checkout RPC), never from the client.
import { adminClient, corsHeaders, dbErrorCode, json, readCheckoutBody, startCheckout, userClient } from '../_shared/http.ts';
import { orderWasPaid, paymentLinkRequest, SQUARE_VERSION, squareBaseUrl, subscriptionLinkRequest } from '../_shared/square.ts';
import { ensurePlanVariation, squareConfig } from '../_shared/squareApi.ts';

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

  const squareApi = squareBaseUrl(Deno.env.get('SQUARE_ENVIRONMENT'));
  const squareHeaders = { Authorization: `Bearer ${accessToken}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' };

  // A new membership checkout replaces the member's unfinished ones. First make
  // sure none of them was actually paid (a webhook can lag a few seconds), and
  // switch their Square payment links off so they can't be paid later.
  if (body.kind !== 'ticket') {
    const { data: open } = await adminClient()
      .from('payments')
      .select('id, provider_session_id, provider_link_id')
      .eq('user_id', auth.user.id).eq('kind', 'membership').eq('status', 'pending').eq('provider', 'square')
      .neq('idempotency_key', body.idempotency_key);
    for (const old of open ?? []) {
      if (old.provider_session_id) {
        const r = await fetch(`${squareApi}/v2/orders/${encodeURIComponent(old.provider_session_id)}`, { headers: squareHeaders });
        const order = (await r.json().catch(() => null))?.order;
        if (r.ok && orderWasPaid(order)) return json(req, { error: 'earlier_payment_completed', payment_id: old.id }, 409);
        if (!r.ok && r.status !== 404) {
          console.error('Square order check failed', r.status);
          return json(req, { error: 'payment_provider_error' }, 502);
        }
      }
      if (old.provider_link_id) {
        const d = await fetch(`${squareApi}/v2/online-checkout/payment-links/${encodeURIComponent(old.provider_link_id)}`, { method: 'DELETE', headers: squareHeaders });
        if (!d.ok && d.status !== 404) console.error('could not switch off old Square payment link', d.status);
      }
    }
  }

  const { data: payment, error } = await startCheckout(supa, body, 'square');
  if (error) return json(req, { error: dbErrorCode(error) }, 400);
  if (payment.status === 'succeeded') return json(req, { payment_id: payment.payment_id, status: 'succeeded' });
  if (payment.status !== 'pending') return json(req, { error: 'payment_not_pending' }, 409);

  // Monthly memberships are sold as a Square subscription (card saved and
  // charged each month by Square); everything else is a one-off payment.
  let linkBody: unknown;
  if (body.kind !== 'ticket' && payment.billing_interval === 'monthly') {
    const cfg = squareConfig();
    const { data: plan } = await adminClient().from('membership_plans')
      .select('id, code, name, price_cents, currency').eq('id', payment.plan_id).maybeSingle();
    const variationId = cfg && plan
      ? await ensurePlanVariation(adminClient(), cfg, { ...plan, price_cents: payment.amount_cents, periods: payment.commitment_months ?? 3 })
      : null;
    if (!variationId) return json(req, { error: 'payment_provider_error' }, 502);
    linkBody = subscriptionLinkRequest(payment, {
      locationId, siteUrl, variationId, buyerEmail: auth.user.email,
      supportEmail: Deno.env.get('SUPPORT_EMAIL'), commitmentMonths: payment.commitment_months ?? 3,
    });
  } else {
    linkBody = paymentLinkRequest(payment, {
      locationId,
      siteUrl,
      buyerEmail: auth.user.email,
      kind: body.kind === 'ticket' ? (payment.kind === 'drop_in' ? 'drop_in' : 'ticket') : 'membership',
      supportEmail: Deno.env.get('SUPPORT_EMAIL'),
    });
  }

  // The idempotency key is derived from our payment id, so a retry gets the
  // same Square link back: one payment record can never be paid twice.
  const res = await fetch(`${squareApi}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: squareHeaders,
    body: JSON.stringify(linkBody),
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
      .update({ provider_session_id: link.order_id, provider_link_id: link.id ?? null, ...(sandbox ? { is_test: true } : {}) })
      .eq('id', payment.payment_id)
      .eq('status', 'pending');
    if (saveError) {
      console.error('could not save Square order id', saveError.message);
      return json(req, { error: 'server_error' }, 500);
    }
  }

  return json(req, { url: link.url, payment_id: payment.payment_id, superseded: payment.superseded ?? [] });
});
