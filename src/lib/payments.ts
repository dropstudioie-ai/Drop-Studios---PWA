import { supabase } from './supabase';

export type PaymentsMode = 'stripe' | 'test';
export const paymentsMode: PaymentsMode = import.meta.env.VITE_PAYMENTS_MODE === 'test' ? 'test' : 'stripe';

export interface CheckoutRequest {
  plan_id: string;
  selected_style_id: string | null;
  idempotency_key: string;
}

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

/** Real payment: returns a Stripe Checkout URL to redirect to. */
export const startStripeCheckout = (req: CheckoutRequest) =>
  invoke<{ url?: string; payment_id: string; status?: string }>('create-checkout', { ...req });

/** Development only. The server refuses unless ALLOW_TEST_PAYMENTS=true. */
export const completeTestCheckout = (req: CheckoutRequest) =>
  invoke<{ payment_id: string; membership_id: string; is_test: true }>('dev-checkout', { ...req });
