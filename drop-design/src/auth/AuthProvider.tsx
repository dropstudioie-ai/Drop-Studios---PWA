import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { drop } from '../drop/client';

export interface StaffProfile { id: string; full_name: string | null; email: string | null; role: string; finance_access: boolean | null }

interface Auth {
  loading: boolean;
  session: Session | null;
  profile: StaffProfile | null;
  /** Drop admins and instructors may use the design tools. */
  isStaff: boolean;
  isAdmin: boolean;
  /** Only full admins (with finance access) may see invoices. */
  canInvoice: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    drop.auth.getSession().then(({ data }) => { if (live) { setSession(data.session); if (!data.session) setLoading(false); } });
    const { data: sub } = drop.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setProfile(null); setLoading(false); } });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    setLoading(true);
    drop.from('profiles').select('id, full_name, email, role, finance_access').eq('id', uid).single()
      .then(({ data }) => { setProfile((data as StaffProfile) ?? null); setLoading(false); });
  }, [session?.user.id]);

  const isAdmin = profile?.role === 'admin';
  const value: Auth = {
    loading, session, profile,
    isStaff: isAdmin || profile?.role === 'instructor',
    isAdmin,
    canInvoice: isAdmin && profile?.finance_access !== false,
    signIn: async (email, password) => {
      const { error } = await drop.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    },
    signOut: async () => { await drop.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
