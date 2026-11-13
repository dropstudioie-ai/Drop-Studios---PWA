import { createClient } from '@supabase/supabase-js';
import { DROP } from '../config';

/** Supabase client for the Drop Studios database (sign-in, events, artwork upload). */
export const drop = createClient(DROP.url, DROP.key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'drop-design-auth' },
});
