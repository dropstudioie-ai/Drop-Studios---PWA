// Square helpers shared by create-checkout and square-webhook.
// Field names and the signature scheme follow Square's official SDK
// (square@46, API version 2026-09-16).

export const SQUARE_VERSION = '2026-09-16';

export function squareBaseUrl(environment: string | undefined): string {
  return environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

export interface CheckoutPayment {
  payment_id: string;
  amount_cents: number;
  currency: string;
  plan_name: string;
  class_count: number | null;
}

/** Body for POST /v2/online-checkout/payment-links. */
export function paymentLinkRequest(
  p: CheckoutPayment,
  opts: { locationId: string; siteUrl: string; buyerEmail?: string | null; kind: 'membership' | 'ticket' | 'drop_in'; supportEmail?: string | null },
) {
  return {
    // Same key for retries, so Square returns the same link instead of a second one.
    idempotency_key: `drop-link-${p.payment_id}`,
    description: `Drop Studios ${p.payment_id}`,
    order: {
      location_id: opts.locationId,
      reference_id: p.payment_id,
      line_items: [{
        name: `Drop Studios — ${p.plan_name}`,
        quantity: '1',
        note: opts.kind === 'ticket' ? 'Workshop ticket'
          : opts.kind === 'drop_in' ? 'Drop In: single class'
          : `${p.class_count} classes. Prepaid pack, no subscription.`,
        base_price_money: { amount: p.amount_cents, currency: p.currency.toUpperCase() },
      }],
    },
    checkout_options: {
      redirect_url: `${opts.siteUrl}/checkout/success?payment_id=${p.payment_id}`,
      allow_tipping: false,
      ask_for_shipping_address: false,
      // Phone wallets: much faster than typing a card (shown when the buyer's device supports them).
      accepted_payment_methods: { apple_pay: true, google_pay: true },
      ...(opts.supportEmail ? { merchant_support_email: opts.supportEmail } : {}),
    },
    ...(opts.buyerEmail ? { pre_populated_data: { buyer_email: opts.buyerEmail } } : {}),
    payment_note: `Drop Studios app payment ${p.payment_id}`,
  };
}

/**
 * Square signs each notification with HMAC-SHA256 over
 * (notification URL + raw body), base64-encoded, sent in x-square-hmacsha256-signature.
 */
export async function squareSignature(signatureKey: string, notificationUrl: string, rawBody: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(notificationUrl + rawBody));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function verifySquareSignature(
  signatureKey: string,
  notificationUrl: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !signatureKey || !notificationUrl) return false;
  const expected = await squareSignature(signatureKey, notificationUrl, rawBody);
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

interface Money { amount?: number; currency?: string }

export type WebhookAction =
  | { kind: 'fulfil'; orderId: string; squarePaymentId: string; amountCents: number; currency: string; customerId: string | null; feeCents: number | null }
  | { kind: 'refund'; squarePaymentId: string; refundId: string; amountCents: number; currency: string }
  | { kind: 'ignore'; reason: string };

export interface SquarePaymentLike {
  id?: string; order_id?: string; status?: string; amount_money?: Money; customer_id?: string;
  processing_fee?: { amount_money?: Money }[];
}

/** Square's processing fee on a payment in cents, or null while Square hasn't reported it yet. */
export function processingFee(p: SquarePaymentLike | null | undefined): number | null {
  const fees = p?.processing_fee;
  if (!Array.isArray(fees) || fees.length === 0) return null;
  return fees.reduce((sum, f) => sum + Math.max(0, f.amount_money?.amount ?? 0), 0);
}

/** Decides what a Square event means for the app. */
export function webhookAction(event: {
  type?: string;
  data?: { object?: { payment?: SquarePaymentLike; refund?: { id?: string; payment_id?: string; status?: string; amount_money?: Money } } };
}): WebhookAction {
  const type = event.type ?? '';
  if (type === 'payment.created' || type === 'payment.updated') {
    const p = event.data?.object?.payment;
    if (!p?.id || !p.order_id) return { kind: 'ignore', reason: 'payment without order' };
    if (p.status !== 'COMPLETED') return { kind: 'ignore', reason: `payment status ${p.status}` };
    return { kind: 'fulfil', orderId: p.order_id, squarePaymentId: p.id, amountCents: p.amount_money?.amount ?? -1, currency: p.amount_money?.currency ?? '',
      customerId: p.customer_id ?? null, feeCents: processingFee(p) };
  }
  if (type === 'refund.created' || type === 'refund.updated') {
    const r = event.data?.object?.refund;
    if (!r?.id || !r.payment_id) return { kind: 'ignore', reason: 'refund without payment' };
    if (r.status !== 'COMPLETED') return { kind: 'ignore', reason: `refund status ${r.status}` };
    return { kind: 'refund', squarePaymentId: r.payment_id, refundId: r.id, amountCents: r.amount_money?.amount ?? 0, currency: r.amount_money?.currency ?? '' };
  }
  return { kind: 'ignore', reason: `event ${type}` };
}

/**
 * Was money taken on this Square order? A payment-link order stays OPEN until
 * the buyer pays; once paid it carries a tender (and usually becomes COMPLETED).
 */
export function orderWasPaid(order: { state?: string; tenders?: unknown[] } | null | undefined): boolean {
  if (!order) return false;
  return order.state === 'COMPLETED' || (Array.isArray(order.tenders) && order.tenders.length > 0);
}

// ---------------------------------------------------------------------------
// Monthly memberships (Square Subscriptions via subscription plan checkout)
// ---------------------------------------------------------------------------

/**
 * Catalog objects for one monthly plan: a SUBSCRIPTION_PLAN and a single-phase
 * SUBSCRIPTION_PLAN_VARIATION billed MONTHLY at a static price for `periods`
 * payments, after which Square completes the subscription.
 * Body for POST /v2/catalog/batch-upsert.
 */
export function subscriptionPlanUpsert(p: { planCode: string; planName: string; priceCents: number; currency: string; periods: number }) {
  return {
    idempotency_key: `drop-plan-${p.planCode}-${p.priceCents}-${p.periods}`,
    batches: [{
      objects: [
        {
          type: 'SUBSCRIPTION_PLAN',
          id: '#plan',
          subscription_plan_data: { name: `Drop Studios — ${p.planName}` },
        },
        {
          type: 'SUBSCRIPTION_PLAN_VARIATION',
          id: '#variation',
          subscription_plan_variation_data: {
            name: `${p.planName} — monthly, ${p.periods} payments`,
            subscription_plan_id: '#plan',
            phases: [{
              cadence: 'MONTHLY',
              ordinal: 0,
              periods: p.periods,
              pricing: { type: 'STATIC', price_money: { amount: p.priceCents, currency: p.currency.toUpperCase() } },
            }],
          },
        },
      ],
    }],
  };
}

/** Body for POST /v2/online-checkout/payment-links for a monthly plan (quick pay + subscription_plan_id). */
export function subscriptionLinkRequest(
  p: CheckoutPayment,
  opts: { locationId: string; siteUrl: string; variationId: string; buyerEmail?: string | null; supportEmail?: string | null; commitmentMonths: number },
) {
  return {
    idempotency_key: `drop-link-${p.payment_id}`,
    description: `Drop Studios ${p.payment_id}`,
    quick_pay: {
      name: `Drop Studios — ${p.plan_name} (monthly, ${opts.commitmentMonths} payments)`,
      price_money: { amount: p.amount_cents, currency: p.currency.toUpperCase() },
      location_id: opts.locationId,
    },
    checkout_options: {
      subscription_plan_id: opts.variationId,
      redirect_url: `${opts.siteUrl}/checkout/success?payment_id=${p.payment_id}`,
      allow_tipping: false,
      ask_for_shipping_address: false,
      ...(opts.supportEmail ? { merchant_support_email: opts.supportEmail } : {}),
    },
    ...(opts.buyerEmail ? { pre_populated_data: { buyer_email: opts.buyerEmail } } : {}),
    payment_note: `Drop Studios app payment ${p.payment_id}`,
  };
}

export type SubscriptionEvent =
  | { kind: 'invoice_paid'; subscriptionId: string; invoiceId: string; amountCents: number; currency: string; paidAt: string }
  | { kind: 'invoice_failed'; subscriptionId: string; invoiceId: string }
  | { kind: 'subscription'; subscriptionId: string; customerId: string | null; planVariationId: string | null; status: string }
  | { kind: 'none' };

interface Invoice {
  id?: string;
  subscription_id?: string;
  status?: string;
  updated_at?: string;
  payment_requests?: { total_completed_amount_money?: Money; computed_amount_money?: Money }[];
}

/** Subscription-related events (monthly charges and status changes). */
export function subscriptionEvent(event: {
  type?: string;
  created_at?: string;
  data?: { object?: { invoice?: Invoice; subscription?: { id?: string; customer_id?: string; plan_variation_id?: string; status?: string } } };
}): SubscriptionEvent {
  const type = event.type ?? '';
  const inv = event.data?.object?.invoice;
  if (type === 'invoice.payment_made' && inv?.id && inv.subscription_id) {
    const paid = inv.payment_requests?.reduce((sum, r) => sum + (r.total_completed_amount_money?.amount ?? 0), 0) ?? 0;
    const currency = inv.payment_requests?.find((r) => r.total_completed_amount_money)?.total_completed_amount_money?.currency
      ?? inv.payment_requests?.[0]?.computed_amount_money?.currency ?? '';
    return { kind: 'invoice_paid', subscriptionId: inv.subscription_id, invoiceId: inv.id, amountCents: paid, currency, paidAt: inv.updated_at ?? event.created_at ?? new Date().toISOString() };
  }
  if (type === 'invoice.scheduled_charge_failed' && inv?.id && inv.subscription_id) {
    return { kind: 'invoice_failed', subscriptionId: inv.subscription_id, invoiceId: inv.id };
  }
  const sub = event.data?.object?.subscription;
  if ((type === 'subscription.created' || type === 'subscription.updated') && sub?.id) {
    return { kind: 'subscription', subscriptionId: sub.id, customerId: sub.customer_id ?? null, planVariationId: sub.plan_variation_id ?? null, status: sub.status ?? '' };
  }
  return { kind: 'none' };
}

/** Square statuses after which no more months are billed. */
export const ENDED_SUBSCRIPTION_STATUSES = new Set(['CANCELED', 'DEACTIVATED', 'COMPLETED']);

/**
 * Body for POST /v2/subscriptions: restart a paused membership on its new
 * payment date with the saved card, for the payments that are left. It starts
 * today, so Square charges straight away; the key makes retries safe.
 */
export function restartSubscriptionRequest(p: { subscriptionId: string; nextBillingOn: string; locationId: string; variationId: string; customerId: string; cardId: string }) {
  return {
    idempotency_key: `drop-restart-${p.subscriptionId}-${p.nextBillingOn}`,
    location_id: p.locationId,
    plan_variation_id: p.variationId,
    customer_id: p.customerId,
    card_id: p.cardId,
    timezone: 'Europe/Dublin',
  };
}

/** Body for POST /v2/refunds. */
export function refundRequest(p: { paymentId: string; squarePaymentId: string; amountCents: number; currency: string; reason: string }) {
  return {
    idempotency_key: `drop-refund-${p.paymentId}`,
    payment_id: p.squarePaymentId,
    amount_money: { amount: p.amountCents, currency: p.currency.toUpperCase() },
    reason: p.reason.slice(0, 192),
  };
}
