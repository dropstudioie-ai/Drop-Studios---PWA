import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

// The anon key is public by design; row level security protects the data.
export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Extracts the short error code raised by our database functions. */
export function errorCode(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'object' && error && 'message' in error) {
    const msg = String((error as { message: unknown }).message);
    return /^[a-z_]+$/.test(msg) ? msg : null;
  }
  return null;
}

export class AppError extends Error {
  constructor(public code: string | null, message: string) {
    super(message);
  }
}
