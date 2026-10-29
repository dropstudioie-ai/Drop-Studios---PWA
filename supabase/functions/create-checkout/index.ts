// Starts a real Stripe Checkout for a membership plan or a workshop ticket.
// The price comes from the database (create_checkout RPC), never from the client.
import Stripe from 'npm:stripe@17.7.0';
import { adminClient, corsHeaders, dbErrorCode, json, readCheckoutBody, startCheckout, userClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const siteUrl = Deno.env.get('SITE_URL');
  if (!stripeKey || !siteUrl) return json(req, { error: 'payments_not_configured' }, 503);

  const body = await readCheckoutBody(req);
  if (!body) return json(req, { error: 'invalid_request' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);

  const { data: payment, error } = await startCheckout(supa, body, 'stripe');
  if (error) return json(req, { error: dbErrorCode(error) }, 400);
  if (payment.status === 'succeeded') return json(req, { payment_id: payment.payment_id, status: 'succeeded' });
  if (payment.status !== 'pending') return json(req, { error: 'payment_not_pending' }, 409);

  const stripe = new Stripe(stripeKey, { apiVersion: '2025-02-24.acacia' });

  // Retry of the same checkout: reuse the open Stripe session, or expire the
  // old one first so the customer can never pay twice for one payment record.
  if (payment.provider_session_id) {
    const existing = await stripe.checkout.sessions.retrieve(payment.provider_session_id);
    if (existing.status === 'open' && existing.url) return json(req, { url: existing.url, payment_id: payment.payment_id });
    if (existing.status === 'complete') return json(req, { payment_id: payment.payment_id, status: 'processing' });
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      currency: payment.currency.toLowerCase(),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: payment.currency.toLowerCase(),
          unit_amount: payment.amount_cents,
          product_data: {
            name: `Drop Studios — ${payment.plan_name}`,
            description: body.kind === 'ticket'
              ? 'Workshop ticket. Your spot is held for 30 minutes while you pay.'
              : `${payment.class_count} classes. Prepaid pack, no subscription.`,
          },
        },
      }],
      client_reference_id: payment.payment_id,
      customer_email: auth.user.email ?? undefined,
      metadata: { payment_id: payment.payment_id, user_id: auth.user.id },
      payment_intent_data: { metadata: { payment_id: payment.payment_id, user_id: auth.user.id } },
      success_url: `${siteUrl}/checkout/success?payment_id=${payment.payment_id}`,
      cancel_url: `${siteUrl}/checkout/cancelled?payment_id=${payment.payment_id}`,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      locale: 'en',
    },
    { idempotencyKey: `checkout-${payment.payment_id}-${payment.provider_session_id ?? 'first'}` },
  );

  const { error: saveError } = await adminClient()
    .from('payments')
    .update({ provider_session_id: session.id })
    .eq('id', payment.payment_id)
    .eq('status', 'pending');
  if (saveError) {
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    return json(req, { error: 'server_error' }, 500);
  }

  return json(req, { url: session.url, payment_id: payment.payment_id });
});
