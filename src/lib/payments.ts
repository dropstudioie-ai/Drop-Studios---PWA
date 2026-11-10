import { supabase } from './supabase';

// 'live' = real payments through Square. Anything other than 'test' counts as live.
export type PaymentsMode = 'live' | 'test';
export const paymentsMode: PaymentsMode = import.meta.env.VITE_PAYMENTS_MODE === 'test' ? 'test' : 'live';

/** A membership plan, or a ticket for a special event (session_id). */
export type CheckoutRequest =
  | { plan_id: string; selected_style_id: string | null; idempotency_key: string }
  | { session_id: string; idempotency_key: string };

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // FunctionsHttpError carries the response; our functions return { error: code }.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw Object.assign(new Error(payload.error), { code: payload.error });
    }
    throw error;
  }
  return data as T;
}

/** Real payment: returns a Square checkout URL to redirect to. */
export interface Superseded { payment_id: string; plan_name: string; created_at: string }

export const startSquareCheckout = (req: CheckoutRequest) =>
  invoke<{ url?: string; payment_id: string; status?: string; superseded?: Superseded[] }>('create-checkout', { ...req });

/** Development only. The server refuses unless ALLOW_TEST_PAYMENTS=true. */
export const completeTestCheckout = (req: CheckoutRequest) =>
  invoke<{ payment_id: string; membership_id: string | null; booking_id: string | null; is_test: true }>('dev-checkout', { ...req });

/** Starts payment for either kind of checkout and returns where to go next. */
export async function checkout(req: CheckoutRequest): Promise<({ redirect: string } | { navigate: string }) & { superseded?: Superseded[] }> {
  if (paymentsMode === 'test') {
    const res = await completeTestCheckout(req);
    return { navigate: `/checkout/success?payment_id=${res.payment_id}` };
  }
  const res = await startSquareCheckout(req);
  const superseded = res.superseded ?? [];
  return res.url ? { redirect: res.url, superseded } : { navigate: `/checkout/success?payment_id=${res.payment_id}`, superseded };
}
