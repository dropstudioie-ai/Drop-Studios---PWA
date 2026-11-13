// Public configuration. The Drop key below is Supabase's *publishable* key: it is meant to be
// public (it ships in the Drop app's own website) and only allows what the database rules allow.
export const DROP = {
  url: import.meta.env.VITE_DROP_SUPABASE_URL || 'https://plskvdfcjdxkfiznguzo.supabase.co',
  key: import.meta.env.VITE_DROP_SUPABASE_ANON_KEY || 'sb_publishable_GP9NY0daQRgVoWP2xg0NGw_fYxSp2ZN',
  site: 'https://www.dropstudios.ie',
};
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
