import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** The front door code, shown to members booked into a class (until the class ends). */
export function ClassDoorCode({ sessionId, className = '' }: { sessionId: string; className?: string }) {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.rpc('class_access', { p_session_id: sessionId }).then(({ data }) => { if (live) setCode((data as string | null) ?? null); });
    return () => { live = false; };
  }, [sessionId]);
  if (!code) return null;
  return (
    <p className={`rounded-xl bg-brand-50 p-2 text-sm text-ink ${className}`}>
      🔑 Front door code: <strong className="font-mono">{code}</strong> · Please keep the front door closed at all times.
    </p>
  );
}
