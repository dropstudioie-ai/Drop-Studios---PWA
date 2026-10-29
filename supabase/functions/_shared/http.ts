// Shared helpers for Drop Studios edge functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin || '*' : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

/** Client acting as the calling customer (RLS + auth.uid() apply). */
export function userClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
}

/** Server-only client. The service role key never leaves the edge runtime. */
export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

export interface CheckoutBody {
  plan_id: string;
  selected_style_id: string | null;
  idempotency_key: string;
}

export async function readCheckoutBody(req: Request): Promise<CheckoutBody | null> {
  try {
    const b = await req.json();
    if (typeof b?.plan_id !== 'string' || typeof b?.idempotency_key !== 'string') return null;
    return {
      plan_id: b.plan_id,
      selected_style_id: typeof b.selected_style_id === 'string' ? b.selected_style_id : null,
      idempotency_key: b.idempotency_key,
    };
  } catch {
    return null;
  }
}

/** Database functions raise short codes like "intro_not_eligible". */
export function dbErrorCode(error: { message?: string } | null): string {
  const msg = error?.message ?? '';
  return /^[a-z_]+$/.test(msg) ? msg : 'server_error';
}
