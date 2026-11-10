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
  | { kind: 'fulfil'; orderId: string; squarePaymentId: string; amountCents: number; currency: string }
  | { kind: 'refund'; squarePaymentId: string; refundId: string; amountCents: number; currency: string }
  | { kind: 'ignore'; reason: string };

/** Decides what a Square event means for the app. */
export function webhookAction(event: {
  type?: string;
  data?: { object?: { payment?: { id?: string; order_id?: string; status?: string; amount_money?: Money }; refund?: { id?: string; payment_id?: string; status?: string; amount_money?: Money } } };
}): WebhookAction {
  const type = event.type ?? '';
  if (type === 'payment.created' || type === 'payment.updated') {
    const p = event.data?.object?.payment;
    if (!p?.id || !p.order_id) return { kind: 'ignore', reason: 'payment without order' };
    if (p.status !== 'COMPLETED') return { kind: 'ignore', reason: `payment status ${p.status}` };
    return { kind: 'fulfil', orderId: p.order_id, squarePaymentId: p.id, amountCents: p.amount_money?.amount ?? -1, currency: p.amount_money?.currency ?? '' };
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
