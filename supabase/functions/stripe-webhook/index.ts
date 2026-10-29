// Stripe webhook: the ONLY place a real payment activates a membership.
// Deploy with --no-verify-jwt; authenticity comes from the Stripe signature.
import Stripe from 'npm:stripe@17.7.0';
import { adminClient } from '../_shared/http.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', { apiVersion: '2025-02-24.acacia' });
const cryptoProvider = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!signature || !secret) return new Response('missing signature', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, secret, undefined, cryptoProvider);
  } catch (err) {
    console.error('signature verification failed', (err as Error).message);
    return new Response('invalid signature', { status: 400 });
  }

  const db = adminClient();

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.payment_status !== 'paid') break; // async methods settle later
      const paymentId = s.metadata?.payment_id ?? s.client_reference_id;
      if (!paymentId) break;
      const { data, error } = await db.rpc('fulfill_payment', {
        p_payment_id: paymentId,
        p_provider: 'stripe',
        p_provider_ref: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? s.id,
        p_provider_event_id: event.id,
        p_amount_cents: s.amount_total,
        p_currency: s.currency,
      });
      if (error) {
        console.error('fulfill_payment failed', error.message);
        return new Response('fulfilment error', { status: 500 }); // Stripe retries
      }
      if (data && !data.ok) console.error('payment rejected', paymentId, data.error);
      break;
    }
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const paymentId = s.metadata?.payment_id ?? s.client_reference_id;
      if (paymentId) {
        await db.from('payments')
          .update({ status: event.type === 'checkout.session.expired' ? 'cancelled' : 'failed' })
          .eq('id', paymentId).eq('status', 'pending').eq('provider_session_id', s.id);
      }
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const paymentId = charge.metadata?.payment_id;
      if (paymentId && charge.refunded) {
        // Record the refund. Whether to revoke remaining classes is a studio
        // decision taken in Admin → Customers (grant/revoke with a reason).
        await db.from('payments').update({ status: 'refunded' }).eq('id', paymentId).eq('status', 'succeeded');
        await db.from('audit_log').insert({
          action: 'payment_refunded', entity_type: 'payment', entity_id: paymentId,
          details: { stripe_charge: charge.id, amount_refunded: charge.amount_refunded },
        });
      }
      break;
    }
    default:
      break;
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
});
