import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice, Field, Spinner } from './ui';

/** Digits of a mobile number; at least 7 for it to count. */
export const validPhone = (v: string) => v.replace(/\D/g, '').length >= 7;

/** Asks for a mobile number before paying (required for every purchase). */
export function PhoneGate({ onSaved }: { onSaved?: () => void }) {
  const { session, refreshProfile } = useAuth();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card space-y-3 border-2 border-accent-500 p-4">
      <p className="font-bold">Add your mobile number to continue</p>
      <p className="text-sm text-ink-soft">We need a mobile number on every account before a purchase, so the studio can reach you about your classes.</p>
      <Field label="Mobile"><input className="input" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="087 123 4567" /></Field>
      {error && <ErrorNotice error={error} />}
      <button className="btn-primary w-full" disabled={busy || !validPhone(phone)} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          await api.updateProfile(session!.user.id, { phone: phone.trim() });
          await refreshProfile();
          onSaved?.();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}>{busy && <Spinner />}Save and continue</button>
    </div>
  );
}
