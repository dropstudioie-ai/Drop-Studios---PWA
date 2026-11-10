// Calls to Square's API for monthly memberships (server side only).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { billingAnchorRequest, refundRequest, SQUARE_VERSION, squareBaseUrl, subscriptionPlanUpsert } from './square.ts';

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

export interface SquareSubscription { id: string; customer_id?: string; plan_variation_id?: string; status?: string; created_at?: string }

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

/** Tell Square about a payment date moved by a pause, and remember it's done. */
export async function syncBillingIfNeeded(db: SupabaseClient, cfg: SquareConfig | null, subscriptionId: string) {
  if (!cfg) return;
  const { data: sub } = await db.from('member_subscriptions')
    .select('provider_subscription_id, billing_sync_needed, next_billing_on, pending_shift_days').eq('id', subscriptionId).maybeSingle();
  if (!sub?.billing_sync_needed || !sub.provider_subscription_id || !sub.next_billing_on) return;
  const r = await call(cfg, `/v2/subscriptions/${encodeURIComponent(sub.provider_subscription_id)}/billing-anchor`, {
    method: 'POST', body: JSON.stringify(billingAnchorRequest(sub.next_billing_on, sub.pending_shift_days)),
  });
  if (r.ok) await db.rpc('mark_billing_synced', { p_subscription_id: subscriptionId });
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
