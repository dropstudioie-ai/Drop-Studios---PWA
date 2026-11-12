// Calls to Square's API for monthly memberships (server side only).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { refundRequest, restartSubscriptionRequest, SQUARE_VERSION, squareBaseUrl, subscriptionPlanUpsert } from './square.ts';

export interface SquareConfig {
  base: string;
  environment: 'sandbox' | 'production';
  headers: Record<string, string>;
  locationId: string;
}

export function squareConfig(): SquareConfig | null {
  const token = Deno.env.get('SQUARE_ACCESS_TOKEN');
  const locationId = Deno.env.get('SQUARE_LOCATION_ID');
  if (!token || !locationId) return null;
  const environment = Deno.env.get('SQUARE_ENVIRONMENT') === 'production' ? 'production' : 'sandbox';
  return {
    base: squareBaseUrl(environment),
    environment,
    locationId,
    headers: { Authorization: `Bearer ${token}`, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json' },
  };
}

async function call<T>(cfg: SquareConfig, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T & { errors?: unknown[] } }> {
  const res = await fetch(`${cfg.base}${path}`, { ...init, headers: cfg.headers });
  const body = await res.json().catch(() => ({})) as T & { errors?: unknown[] };
  if (!res.ok) console.error('Square', init.method ?? 'GET', path, res.status, JSON.stringify(body.errors ?? body).slice(0, 500));
  return { ok: res.ok, status: res.status, body };
}

/**
 * The Square plan variation for a monthly plan at its current price, created
 * the first time it's needed and remembered in square_plan_variations.
 */
export async function ensurePlanVariation(
  db: SupabaseClient,
  cfg: SquareConfig,
  plan: { id: string; code: string; name: string; price_cents: number; currency: string; periods: number },
): Promise<string | null> {
  const { data: known } = await db.from('square_plan_variations').select('variation_id')
    .eq('plan_id', plan.id).eq('environment', cfg.environment).eq('price_cents', plan.price_cents).eq('periods', plan.periods).maybeSingle();
  if (known?.variation_id) return known.variation_id;

  const r = await call<{ id_mappings?: { client_object_id: string; object_id: string }[] }>(cfg, '/v2/catalog/batch-upsert', {
    method: 'POST',
    body: JSON.stringify(subscriptionPlanUpsert({ planCode: plan.code, planName: plan.name, priceCents: plan.price_cents, currency: plan.currency, periods: plan.periods })),
  });
  if (!r.ok) return null;
  const id = (temp: string) => r.body.id_mappings?.find((m) => m.client_object_id === temp)?.object_id;
  const planObjectId = id('#plan');
  const variationId = id('#variation');
  if (!planObjectId || !variationId) return null;
  await db.from('square_plan_variations').upsert({
    plan_id: plan.id, environment: cfg.environment, price_cents: plan.price_cents, periods: plan.periods, plan_object_id: planObjectId, variation_id: variationId,
  });
  return variationId;
}

export interface SquareSubscription { id: string; customer_id?: string; plan_variation_id?: string; status?: string; created_at?: string; card_id?: string }

/** The member's newest subscription to this plan variation (just created by checkout). */
export async function findSubscription(cfg: SquareConfig, customerId: string, variationId: string | null): Promise<SquareSubscription | null> {
  const r = await call<{ subscriptions?: SquareSubscription[] }>(cfg, '/v2/subscriptions/search', {
    method: 'POST',
    body: JSON.stringify({ query: { filter: { customer_ids: [customerId], location_ids: [cfg.locationId] } } }),
  });
  const subs = (r.body.subscriptions ?? [])
    .filter((s) => !variationId || s.plan_variation_id === variationId)
    .filter((s) => s.status === 'ACTIVE' || s.status === 'PENDING')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return subs[0] ?? null;
}

export async function retrieveSubscription(cfg: SquareConfig, id: string): Promise<SquareSubscription | null> {
  const r = await call<{ subscription?: SquareSubscription }>(cfg, `/v2/subscriptions/${encodeURIComponent(id)}`);
  return r.ok ? r.body.subscription ?? null : null;
}

export async function customerEmail(cfg: SquareConfig, customerId: string): Promise<string | null> {
  const r = await call<{ customer?: { email_address?: string } }>(cfg, `/v2/customers/${encodeURIComponent(customerId)}`);
  return r.ok ? r.body.customer?.email_address?.toLowerCase() ?? null : null;
}

/** Square stops billing at the end of the current billing month. */
export async function cancelSubscription(cfg: SquareConfig, id: string): Promise<boolean> {
  const r = await call(cfg, `/v2/subscriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' });
  return r.ok;
}

/** Send the cancellation to Square when our records say it's due, and remember it. */
export async function sendCancelIfDue(db: SupabaseClient, cfg: SquareConfig | null, subscriptionId: string, due: boolean | undefined) {
  if (!due || !cfg) return;
  const { data: sub } = await db.from('member_subscriptions').select('provider_subscription_id, provider_cancel_sent_at')
    .eq('id', subscriptionId).maybeSingle();
  if (!sub?.provider_subscription_id || sub.provider_cancel_sent_at) return; // linked later → webhook retries it
  if (await cancelSubscription(cfg, sub.provider_subscription_id)) {
    await db.rpc('mark_provider_cancel_sent', { p_subscription_id: subscriptionId });
  }
}

/**
 * A pause moved the next payment: stop the Square subscription at the end of
 * the paid month (no charge on the old date). subscription-jobs starts a new
 * one on the new date.
 */
export async function syncBillingIfNeeded(db: SupabaseClient, cfg: SquareConfig | null, subscriptionId: string) {
  if (!cfg) return;
  const { data: sub } = await db.from('member_subscriptions')
    .select('provider_subscription_id, provider_card_id, billing_sync_needed, pending_restart').eq('id', subscriptionId).maybeSingle();
  if (!sub?.billing_sync_needed || !sub.provider_subscription_id || sub.pending_restart) return;
  if (!sub.provider_card_id) {
    const sq = await retrieveSubscription(cfg, sub.provider_subscription_id);
    if (sq?.card_id) await db.from('member_subscriptions').update({ provider_card_id: sq.card_id }).eq('id', subscriptionId);
  }
  if (await cancelSubscription(cfg, sub.provider_subscription_id)) {
    await db.rpc('mark_billing_synced', { p_subscription_id: subscriptionId });
  }
}

/** Start Square again for paused memberships whose new payment date is today. */
export async function restartDueSubscriptions(db: SupabaseClient, cfg: SquareConfig): Promise<{ restarted: number; failed: number }> {
  const { data: due } = await db.rpc('subscriptions_due_restart');
  let restarted = 0, failed = 0;
  for (const s of (due ?? []) as { subscription_id: string; provider_subscription_id: string | null; provider_customer_id: string | null;
    provider_card_id: string | null; plan_id: string; price_cents: number; payments_left: number; next_billing_on: string }[]) {
    let cardId = s.provider_card_id;
    let customerId = s.provider_customer_id;
    if ((!cardId || !customerId) && s.provider_subscription_id) {
      const old = await retrieveSubscription(cfg, s.provider_subscription_id);
      cardId ??= old?.card_id ?? null;
      customerId ??= old?.customer_id ?? null;
    }
    const { data: plan } = await db.from('membership_plans').select('id, code, name, currency').eq('id', s.plan_id).maybeSingle();
    const variationId = plan ? await ensurePlanVariation(db, cfg, { ...plan, price_cents: s.price_cents, periods: s.payments_left }) : null;
    if (!cardId || !customerId || !variationId) { failed++; console.error('cannot restart subscription', s.subscription_id); continue; }
    const r = await call<{ subscription?: SquareSubscription }>(cfg, '/v2/subscriptions', {
      method: 'POST',
      body: JSON.stringify(restartSubscriptionRequest({
        subscriptionId: s.subscription_id, nextBillingOn: s.next_billing_on, locationId: cfg.locationId, variationId, customerId, cardId,
      })),
    });
    if (!r.ok || !r.body.subscription?.id) { failed++; continue; }
    await db.rpc('replace_provider_subscription', { p_subscription_id: s.subscription_id, p_provider_subscription_id: r.body.subscription.id });
    restarted++;
  }
  return { restarted, failed };
}

/** Square's payment id for one of our payments (invoice payments are looked up through the invoice's order). */
export async function squarePaymentIdFor(cfg: SquareConfig, ref: string | null): Promise<string | null> {
  if (!ref) return null;
  if (!ref.startsWith('inv:')) return ref;
  const inv = await call<{ invoice?: { order_id?: string } }>(cfg, `/v2/invoices/${encodeURIComponent(ref.slice(4))}`);
  const orderId = inv.body.invoice?.order_id;
  if (!orderId) return null;
  const ord = await call<{ order?: { tenders?: { id?: string; payment_id?: string }[] } }>(cfg, `/v2/orders/${encodeURIComponent(orderId)}`);
  const t = ord.body.order?.tenders?.[0];
  return t?.payment_id ?? t?.id ?? null;
}

export async function refundPayment(cfg: SquareConfig, p: Parameters<typeof refundRequest>[0]) {
  return call<{ refund?: { id?: string; status?: string } }>(cfg, '/v2/refunds', { method: 'POST', body: JSON.stringify(refundRequest(p)) });
}

/** The Square customer on an order (a subscription checkout puts the buyer there). */
export async function orderCustomer(cfg: SquareConfig, orderId: string): Promise<string | null> {
  const r = await call<{ order?: { customer_id?: string } }>(cfg, `/v2/orders/${encodeURIComponent(orderId)}`);
  return r.ok ? r.body.order?.customer_id ?? null : null;
}
