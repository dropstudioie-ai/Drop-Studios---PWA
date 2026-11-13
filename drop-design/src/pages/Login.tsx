import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Spinner } from '../components/ui';
import { Logo } from '../components/Logo';

export default function Login() {
  const { signIn, session, profile, isStaff, signOut } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = session && profile && !isStaff;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await signIn(email, password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl">
        <Logo />
        <p className="mt-3 text-sm text-muted">Private design studio for the Drop Studios team. Sign in with your Drop account.</p>
        {blocked ? (
          <div className="mt-5 space-y-3">
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">This account doesn’t have access. Drop Design is for Drop admins and instructors only.</p>
            <button className="btn-outline w-full" onClick={() => void signOut()}>Use another account</button>
          </div>
        ) : (
          <form className="mt-5 space-y-3" onSubmit={(e) => void submit(e)}>
            <label className="block"><span className="label">Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
            <label className="block"><span className="label">Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : 'Sign in'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
