// Square webhook: the ONLY place a real payment activates a membership or
// confirms a workshop ticket. Deploy with --no-verify-jwt; authenticity comes
// from Square's signature. Square sends events for every payment on the
// account (including card-reader sales in the studio), so anything that isn't
// an app checkout is acknowledged and ignored.
import { adminClient } from '../_shared/http.ts';
import { ENDED_SUBSCRIPTION_STATUSES, subscriptionEvent, verifySquareSignature, webhookAction } from '../_shared/square.ts';
import { cancelSubscription, customerEmail, findSubscription, retrieveSubscription, sendCancelIfDue, squareConfig, syncBillingIfNeeded, type SquareConfig } from '../_shared/squareApi.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

/** Link our new subscription (started by its first payment) to Square's. */
async function linkSubscription(db: SupabaseClient, cfg: SquareConfig | null, paymentId: string, subscriptionId: string, customerId: string | null) {
  if (customerId) await db.from('member_subscriptions').update({ provider_customer_id: customerId }).eq('id', subscriptionId);
  if (!cfg || !customerId) return;
  const { data: pay } = await db.from('payments').select('plan_id, amount_cents').eq('id', paymentId).maybeSingle();
  const { data: v } = pay ? await db.from('square_plan_variations').select('variation_id')
    .eq('plan_id', pay.plan_id).eq('environment', cfg.environment).eq('price_cents', pay.amount_cents).maybeSingle() : { data: null };
  const sq = await findSubscription(cfg, customerId, v?.variation_id ?? null);
  if (!sq) return; // subscription.created will link it
  const { data } = await db.rpc('link_provider_subscription', { p_payment_id: paymentId, p_provider_subscription_id: sq.id, p_provider_customer_id: customerId });
  await sendCancelIfDue(db, cfg, subscriptionId, data?.send_provider_cancel);
  await syncBillingIfNeeded(db, cfg, subscriptionId);
}

/** After an upgrade, stop the old plan's Square subscription (no more charges). */
async function stopUpgradedSubscription(db: SupabaseClient, cfg: SquareConfig | null, oldSubscriptionId: string | null | undefined) {
  if (!cfg || !oldSubscriptionId) return;
  const { data: old } = await db.from('member_subscriptions').select('provider_subscription_id, provider_cancel_sent_at').eq('id', oldSubscriptionId).maybeSingle();
  if (!old?.provider_subscription_id || old.provider_cancel_sent_at) return;
  if (await cancelSubscription(cfg, old.provider_subscription_id)) await db.rpc('mark_provider_cancel_sent', { p_subscription_id: oldSubscriptionId });
}

/**
 * Our subscription for a Square subscription id. If it isn't linked yet, find it
 * through the Square customer (set by the first payment), or as a last resort
 * the customer's email and the member's unpaid monthly checkout.
 */
async function ourSubscription(db: SupabaseClient, cfg: SquareConfig | null, squareSubId: string, firstInvoice?: { id: string; amountCents: number; currency: string; eventId: string | null }) {
  const { data: known } = await db.from('member_subscriptions').select('id').eq('provider_subscription_id', squareSubId).maybeSingle();
  if (known) return known.id as string;
  if (!cfg) return null;
  const sq = await retrieveSubscription(cfg, squareSubId);
  if (!sq?.customer_id) return null;

  const { data: byCustomer } = await db.from('member_subscriptions').select('id, initial_payment_id')
    .eq('provider_customer_id', sq.customer_id).is('provider_subscription_id', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (byCustomer) {
    const { data } = await db.rpc('link_provider_subscription', { p_payment_id: byCustomer.initial_payment_id, p_provider_subscription_id: squareSubId, p_provider_customer_id: sq.customer_id });
    await sendCancelIfDue(db, cfg, byCustomer.id, data?.send_provider_cancel);
    return byCustomer.id as string;
  }

  // The first month paid without our checkout order being reported: match the
  // member by email to their unpaid monthly checkout and complete it now.
  if (!firstInvoice) return null;
  const email = await customerEmail(cfg, sq.customer_id);
  if (!email) return null;
  const { data: profile } = await db.from('profiles').select('id').ilike('email', email).maybeSingle();
  if (!profile) return null;
  const { data: pending } = await db.from('payments').select('id').eq('user_id', profile.id).eq('provider', 'square')
    .eq('kind', 'membership').eq('status', 'pending').eq('amount_cents', firstInvoice.amountCents)
    .contains('plan_snapshot', { billing_interval: 'monthly' }).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!pending) return null;
  const { data: res, error } = await db.rpc('fulfill_payment', {
    p_payment_id: pending.id, p_provider: 'square', p_provider_ref: `inv:${firstInvoice.id}`, p_provider_event_id: firstInvoice.eventId,
    p_amount_cents: firstInvoice.amountCents, p_currency: firstInvoice.currency,
  });
  if (error || !res?.subscription_id) return null;
  await db.rpc('link_provider_subscription', { p_payment_id: pending.id, p_provider_subscription_id: squareSubId, p_provider_customer_id: sq.customer_id });
  await stopUpgradedSubscription(db, cfg, res.cancel_provider_subscription_of);
  return res.subscription_id as string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const signatureKey = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? '';
  // Must be exactly the notification URL registered in the Square Developer Console.
  const notificationUrl = Deno.env.get('SQUARE_WEBHOOK_URL') ?? '';
  const rawBody = await req.text();
  const ok = await verifySquareSignature(signatureKey, notificationUrl, rawBody, req.headers.get('x-square-hmacsha256-signature'));
  if (!ok) {
    console.error('Square signature verification failed');
    return new Response('invalid signature', { status: 401 });
  }

  let event: { event_id?: string; type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('invalid body', { status: 400 });
  }

  const action = webhookAction(event as Parameters<typeof webhookAction>[0]);
  const db = adminClient();

  if (action.kind === 'fulfil') {
    const { data: payment } = await db
      .from('payments')
      .select('id')
      .eq('provider', 'square')
      .eq('provider_session_id', action.orderId)
      .maybeSingle();
    if (!payment) return Response.json({ ignored: 'not an app checkout' });

    const { data, error } = await db.rpc('fulfill_payment', {
      p_payment_id: payment.id,
      p_provider: 'square',
      p_provider_ref: action.squarePaymentId,
      p_provider_event_id: event.event_id ?? null,
      p_amount_cents: action.amountCents,
      p_currency: action.currency,
    });
    if (error) {
      console.error('fulfill_payment failed', error.message);
      return new Response('fulfilment error', { status: 500 }); // Square retries
    }
    if (data && !data.ok) console.error('payment rejected', payment.id, data.error);
    if (data?.refund_required) console.error('ticket paid but no spot available — refund needed', payment.id);
    // First month of a monthly membership: find the subscription Square created.
    if (data?.subscription_id) {
      const cfg = squareConfig();
      await linkSubscription(db, cfg, payment.id, data.subscription_id, action.customerId);
      await stopUpgradedSubscription(db, cfg, data.cancel_provider_subscription_of);
    }
    return Response.json({ received: true });
  }

  // Monthly memberships: charges, failures and status changes.
  const sub = subscriptionEvent(event as Parameters<typeof subscriptionEvent>[0]);
  if (sub.kind !== 'none') {
    const cfg = squareConfig();
    if (sub.kind === 'invoice_paid') {
      const ours = await ourSubscription(db, cfg, sub.subscriptionId,
        { id: sub.invoiceId, amountCents: sub.amountCents, currency: sub.currency, eventId: event.event_id ?? null });
      if (!ours) return Response.json({ ignored: 'not an app subscription' });
      const { data, error } = await db.rpc('fulfill_subscription_charge', {
        p_provider_subscription_id: sub.subscriptionId, p_provider_payment_ref: `inv:${sub.invoiceId}`,
        p_provider_event_id: event.event_id ?? null, p_amount_cents: sub.amountCents, p_currency: sub.currency, p_paid_at: sub.paidAt,
      });
      if (error) {
        console.error('fulfill_subscription_charge failed', error.message);
        return new Response('fulfilment error', { status: 500 }); // Square retries
      }
      if (data?.review) console.error('subscription payment needs review', data.payment_id);
      await sendCancelIfDue(db, cfg, ours, data?.send_provider_cancel);
      return Response.json({ received: true });
    }
    if (sub.kind === 'invoice_failed') {
      const ours = await ourSubscription(db, cfg, sub.subscriptionId);
      if (!ours) return Response.json({ ignored: 'not an app subscription' });
      await db.rpc('subscription_charge_failed', { p_provider_subscription_id: sub.subscriptionId, p_provider_payment_ref: `inv:${sub.invoiceId}` });
      return Response.json({ received: true });
    }
    // subscription.created / subscription.updated
    const ours = await ourSubscription(db, cfg, sub.subscriptionId);
    if (!ours) return Response.json({ ignored: 'not an app subscription' });
    if (ENDED_SUBSCRIPTION_STATUSES.has(sub.status)) {
      await db.rpc('subscription_provider_ended', { p_provider_subscription_id: sub.subscriptionId, p_provider_status: sub.status });
    }
    return Response.json({ received: true });
  }

  if (action.kind === 'refund') {
    // Monthly charges are stored by invoice; their Square payment id is saved
    // when an admin refunds them from the app.
    const { data: payment } = await db
      .from('payments')
      .select('id, amount_cents')
      .eq('provider', 'square')
      .or(`provider_payment_ref.eq.${action.squarePaymentId},provider_payment_id.eq.${action.squarePaymentId}`)
      .maybeSingle();
    if (!payment) return Response.json({ ignored: 'not an app payment' });

    // Partial refunds (e.g. a 14-day cancellation minus classes used) are
    // recorded in the audit log; the payment is marked refunded only when the
    // full amount has been returned. Removing remaining classes is a studio
    // decision made in Admin → Customers.
    const { data: already } = await db
      .from('audit_log')
      .select('id')
      .eq('action', 'payment_refunded')
      .eq('entity_id', payment.id)
      .contains('details', { square_refund: action.refundId })
      .maybeSingle();
    if (!already) {
      await db.from('audit_log').insert({
        action: 'payment_refunded', entity_type: 'payment', entity_id: payment.id,
        details: { square_refund: action.refundId, amount_refunded: action.amountCents, currency: action.currency },
      });
      if (action.amountCents >= payment.amount_cents) {
        await db.from('payments').update({ status: 'refunded' }).eq('id', payment.id).eq('status', 'succeeded');
      }
    }
    return Response.json({ received: true });
  }

  return Response.json({ ignored: action.reason });
});
