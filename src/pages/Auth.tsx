import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { ErrorNotice, Field, Notice, Spinner } from '../components/ui';
import { localDateKey } from '../domain/time';
import { validDob } from '../domain/profile';
import { StudioPhoto } from '../components/StudioPhoto';

const todayKey = () => localDateKey(new Date());

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="container-page flex max-w-md flex-col py-10">
      <StudioPhoto index={7} className="mb-6 aspect-[16/8]" />
      <h1 className="text-3xl font-black">{title}</h1>
      {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      <div className="card mt-6 p-5 sm:p-6">{children}</div>
    </div>
  );
}

export function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get('next'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : error.message);
    else navigate(next, { replace: true });
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to book classes and manage your membership.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Log in</button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/forgot-password" className="font-semibold text-brand-700">Forgot password?</Link>
        <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-semibold text-brand-700">Create account</Link>
      </div>
    </AuthShell>
  );
}

export function Register() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', password: '', date_of_birth: '' });
  const [notifications, setNotifications] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const next = safeNext(params.get('next') ?? '/memberships');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validDob(form.date_of_birth)) {
      setError('Please enter your date of birth.');
      return;
    }
    if (form.password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        data: { full_name: form.full_name.trim(), phone: form.phone.trim() || null, date_of_birth: form.date_of_birth, notifications },
        emailRedirectTo: `${window.location.origin}${next}`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else if (!data.session) setCheckEmail(true); // email confirmation enabled
    else navigate(next, { replace: true });
  }

  if (checkEmail) {
    return (
      <AuthShell title="Check your email">
        <Notice tone="success">We’ve sent a confirmation link to <strong>{form.email}</strong>. Open it to activate your account.</Notice>
      </AuthShell>
    );
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <AuthShell title="Join Drop Studios" subtitle="Create your account to book classes.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><input className="input" autoComplete="name" required value={form.full_name} onChange={set('full_name')} /></Field>
        <Field label="Email"><input className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></Field>
        <Field label="Date of birth" hint="So your teacher can wish you a happy birthday. Only studio staff see it."><input className="input" type="date" required autoComplete="bday" min="1900-01-01" max={todayKey()} value={form.date_of_birth} onChange={set('date_of_birth')} /></Field>
        <Field label="Mobile (optional)" hint="Only used if we need to reach you about a class."><input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} /></Field>
        <Field label="Password" hint="At least 8 characters."><input className="input" type="password" autoComplete="new-password" required minLength={8} value={form.password} onChange={set('password')} /></Field>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 h-5 w-5 accent-brand-600" checked={notifications} onChange={(e) => setNotifications(e.target.checked)} />
          <span>Send me class reminders and updates by email and phone notification. You can change this any time in My Membership.</span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" required className="mt-0.5 h-5 w-5 accent-brand-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            I agree to the <Link to="/terms" target="_blank" className="font-semibold text-brand-700 underline">Terms &amp; Conditions</Link> and
            have read the <Link to="/privacy" target="_blank" className="font-semibold text-brand-700 underline">Privacy Policy</Link>. I’m 16 or over.
          </span>
        </label>
        {error && <ErrorNotice error={error} />}
        <button className="btn-primary w-full" disabled={busy || !consent}>{busy && <Spinner />}Create account</button>
      </form>
      <p className="mt-4 text-center text-sm">Already have an account? <Link to="/login" className="font-semibold text-brand-700">Log in</Link></p>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <AuthShell title="Reset your password">
      {sent ? <Notice tone="success">If an account exists for {email}, you’ll get an email with a reset link.</Notice> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <ErrorNotice error={error} />}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Send reset link</button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPassword() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else navigate('/account', { replace: true });
  }

  return (
    <AuthShell title="Choose a new password">
      {!session ? <Notice tone="warn">Open this page from the link in your reset email.</Notice> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password"><input className="input" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <ErrorNotice error={error} />}
          <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner />}Save password</button>
        </form>
      )}
    </AuthShell>
  );
}
