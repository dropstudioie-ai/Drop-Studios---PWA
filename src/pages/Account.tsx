import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Booking, Membership } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AppError } from '../lib/supabase';
import { NotificationSettings } from '../components/NotificationSettings';
import { useAuth } from '../auth/AuthProvider';
import { cancellationOutcome, cutoffLabel, DEFAULT_POLICY } from '../domain/booking';
import { fmt, localDateKey } from '../domain/time';
import { validDob } from '../domain/profile';
import { MembershipCard } from '../components/MembershipCard';
import { manageSubscription } from '../lib/payments';
import { BirthdayCard } from '../components/BirthdayCard';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { OutOfClassesCard } from '../components/OutOfClasses';
import { isLive, outOfClasses } from '../domain/subscription';
import { renewalLink, renewalOffer } from '../domain/renewal';
import { formatPrice } from '../domain/money';
import { ProfilePhotoCard } from '../components/ProfilePhotoCard';
import { PauseSheet } from '../components/PauseSheet';
import { EmptyState, ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../components/ui';

const BOOKING_LABEL: Record<string, string> = {
  booked: 'Booked', pending_payment: 'Payment not completed', attended: 'Attended', no_show: 'No-show', cancelled: 'Cancelled', late_cancelled: 'Late cancellation',
};

export default function Account() {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const toast = useToast();
  const uid = session!.user.id;
  const data = useAsync(async () => {
    const [memberships, bookings, styles, settings, allowance, plans, subscriptions] = await Promise.all([
      api.myMemberships(uid), api.myBookings(uid), api.styles(), api.settings(), api.pauseAllowance(), api.plans(), api.mySubscriptions(uid),
    ]);
    return { memberships, bookings, styles, settings, allowance, plans, subscriptions };
  }, [uid]);

  const [pausing, setPausing] = useState<Membership | null>(null);
  const [cancelling, setCancelling] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);

  if (data.loading && !data.data) return <PageSpinner />;
  if (data.error) return <div className="container-page py-8"><ErrorNotice error={data.error} onRetry={data.reload} /></div>;
  const { memberships, bookings, styles, settings, allowance, plans, subscriptions } = data.data!;
  const renewal = renewalOffer(memberships, plans);
  const liveSubs = subscriptions.filter(isLive);
  const out = outOfClasses(memberships, subscriptions);

  const current = memberships.filter((m) => ['active', 'paused', 'pending_activation'].includes(m.state));
  const past = memberships.filter((m) => !current.includes(m));
  const now = new Date();
  const upcoming = bookings
    .filter((b) => b.status === 'booked' && b.session && new Date(b.session.starts_at) > now)
    .sort((a, b) => a.session!.starts_at.localeCompare(b.session!.starts_at));
  const history = bookings.filter((b) => !upcoming.includes(b));
  const totalRemaining = current.filter((m) => m.state !== 'paused').reduce((s, m) => s + m.classes_remaining, 0);

  async function resume(m: Membership) {
    setBusy(true);
    try {
      await api.resume(m.id);
      if (m.subscription_id) await manageSubscription('sync_billing', m.subscription_id).catch(() => {});
      toast('Pause ended. Welcome back!');
      await data.reload();
    } catch (e) {
      toast(e instanceof AppError ? e.message : 'Could not update the pause.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const policy = { ...DEFAULT_POLICY, ...settings };

  return (
    <div className="container-page max-w-4xl py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Hi {profile?.full_name?.split(' ')[0] || 'there'} 👋</p>
          <h1 className="text-3xl font-black">My Membership</h1>
        </div>
        {current.length > 0 && <p className="font-display text-lg font-extrabold text-brand-700">{totalRemaining} {totalRemaining === 1 ? 'class' : 'classes'} available</p>}
      </div>

      <div className="mt-6 space-y-3"><ProfilePhotoCard />{!profile?.date_of_birth && <BirthdayCard onSaved={refreshProfile} />}</div>

      <section className="mt-6 space-y-4" aria-labelledby="current-h">
        <h2 id="current-h" className="sr-only">Current memberships</h2>
        {out?.kind === 'subscription' && <OutOfClassesCard out={out} />}
        {liveSubs.map((s) => <SubscriptionCard key={s.id} sub={s} onChanged={() => void data.reload()} />)}
        {renewal && (
          <div className="card border-2 border-accent-500 p-5">
            <h3 className="text-lg font-extrabold">You’ve used all your classes</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Your <strong>{renewal.planName}</strong>{renewal.expiresAt ? ` is valid until ${fmt.date(renewal.expiresAt)}` : ''}, but has no classes left.
              {renewal.plan ? ' Renew early to keep booking, or pay per class with a Drop In.' : ' Choose a new membership to keep booking, or pay per class with a Drop In.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to={renewalLink(renewal)} className="btn-primary">
                {renewal.plan ? `Renew early · ${formatPrice(renewal.plan.price_cents, renewal.plan.currency)}` : 'Choose a membership'}
              </Link>
              <Link to="/timetable" className="btn-ghost">Book a Drop In</Link>
            </div>
          </div>
        )}
        {current.length === 0 && (renewal || liveSubs.length) ? null : current.length === 0 ? (
          <EmptyState title={past.length ? 'No active membership' : 'You don’t have a membership yet'}
            action={<Link to="/memberships" className="btn-accent">Explore plans</Link>}>
            Choose a class pack to start booking.
          </EmptyState>
        ) : current.map((m) => (
          <MembershipCard key={m.id} m={m} styles={styles} reminderDays={settings.expiry_reminder_days}
            busy={busy} onPause={() => setPausing(m)} onResume={() => void resume(m)} />
        ))}
      </section>

      <section className="mt-10" aria-labelledby="upcoming-h">
        <div className="flex items-end justify-between">
          <h2 id="upcoming-h" className="text-xl font-black">Upcoming bookings</h2>
          <Link to="/timetable" className="text-sm font-semibold text-brand-700">Book a class →</Link>
        </div>
        <div className="mt-3 space-y-2">
          {upcoming.length === 0 && <p className="text-sm text-muted">No upcoming classes booked.</p>}
          {upcoming.map((b) => (
            <div key={b.id} className="card flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-bold">{b.session!.title}{b.payment_id && <span className="chip ml-2 bg-accent-500 align-middle text-ink">{b.payment?.kind === 'drop_in' ? 'Drop In' : 'Ticket'}</span>}</p>
                <p className="text-sm text-muted">{fmt.dateTime(b.session!.starts_at)}{b.session!.instructor ? ` · ${b.session!.instructor.full_name}` : ''}</p>
              </div>
              {b.payment_id
                ? <span className="max-w-28 text-right text-xs text-muted">Contact the studio to change</span>
                : <button className="btn-sm btn-ghost text-danger" onClick={() => setCancelling(b)}>Cancel</button>}
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10" aria-labelledby="history-h">
        <h2 id="history-h" className="text-xl font-black">Booking history</h2>
        {history.length === 0 ? <p className="mt-3 text-sm text-muted">Your past classes will appear here.</p> : (
          <ul className="card mt-3 divide-y divide-line">
            {history.slice(0, 50).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span>
                  <span className="font-semibold">{b.session?.title}</span>
                  <span className="block text-muted">{b.session && fmt.dateTime(b.session.starts_at)}</span>
                </span>
                <span className="text-right">
                  <span className="font-semibold">{BOOKING_LABEL[b.status]}</span>
                  {(b.status === 'cancelled' || b.status === 'late_cancelled') && (
                    <span className="block text-xs text-muted">{b.class_restored ? 'Class returned' : 'Class used'}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-10" aria-labelledby="past-h">
          <h2 id="past-h" className="text-xl font-black">Previous memberships</h2>
          <div className="mt-3 space-y-3">
            {past.map((m) => <MembershipCard key={m.id} m={m} styles={styles} reminderDays={0} />)}
          </div>
        </section>
      )}

      <NotificationSettings />
      <ProfileSection uid={uid} onSaved={refreshProfile} />

      <div className="mt-10 flex justify-center">
        <button className="btn-ghost" onClick={() => void signOut()}>Log out</button>
      </div>

      {pausing && <PauseSheet membership={pausing} allowance={allowance} onClose={() => setPausing(null)} onDone={() => { toast('Membership paused.'); void data.reload(); }} />}

      {cancelling && (
        <CancelSheet booking={cancelling} policy={policy} onClose={() => setCancelling(null)} onDone={(restored) => {
          toast(restored ? 'Booking cancelled. Your class has been returned.' : 'Booking cancelled. This late cancellation used the class.', restored ? 'success' : 'info');
          void data.reload();
        }} />
      )}
    </div>
  );
}

function CancelSheet({ booking, policy, onClose, onDone }: {
  booking: Booking;
  policy: typeof DEFAULT_POLICY;
  onClose: () => void;
  onDone: (restored: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = cancellationOutcome(new Date(booking.session!.starts_at), new Date(), policy);
  return (
    <Sheet open onClose={onClose} title="Cancel booking?">
      <p className="font-semibold">{booking.session!.title}</p>
      <p className="text-sm text-muted">{fmt.dateTime(booking.session!.starts_at)}</p>
      <div className="mt-4">
        {outcome.restores
          ? <Notice tone="info">You’ll get this class back on your membership.</Notice>
          : <Notice tone="warn">It’s less than {cutoffLabel(policy.cancellation_cutoff_minutes)} before class, so you won’t get this class back.</Notice>}
      </div>
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <div className="mt-5 flex gap-2">
        <button className="btn-ghost flex-1" onClick={onClose}>Keep it</button>
        <button className="btn-danger flex-1" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const res = await api.cancel(booking.id);
            onDone(res.class_restored);
            onClose();
          } catch (e) {
            setError(e instanceof AppError ? e.message : 'Could not cancel.');
            setBusy(false);
          }
        }}>{busy && <Spinner />}Cancel booking</button>
      </div>
    </Sheet>
  );
}

function ProfileSection({ uid, onSaved }: { uid: string; onSaved: () => Promise<void> }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ full_name: profile?.full_name ?? '', phone: profile?.phone ?? '', marketing_opt_in: profile?.marketing_opt_in ?? false, date_of_birth: profile?.date_of_birth ?? '' });
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (form.date_of_birth && !validDob(form.date_of_birth)) throw new Error('dob');
      await api.updateProfile(uid, { full_name: form.full_name.trim(), phone: form.phone.trim() || null, marketing_opt_in: form.marketing_opt_in, date_of_birth: form.date_of_birth || null });
      await onSaved();
      toast('Details saved.');
    } catch {
      toast('Could not save your details.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10" aria-labelledby="profile-h">
      <h2 id="profile-h" className="text-xl font-black">Your details</h2>
      <form onSubmit={save} className="card mt-3 grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Full name"><input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></Field>
        <Field label="Mobile"><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Date of birth" hint="Only studio staff see it."><input className="input" type="date" min="1900-01-01" max={localDateKey(new Date())} value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} /></Field>
        <Field label="Email"><input className="input bg-canvas" value={profile?.email ?? ''} disabled /></Field>
        <label className="flex items-center gap-3 self-end text-sm sm:pb-3">
          <input type="checkbox" className="h-5 w-5 accent-brand-600" checked={form.marketing_opt_in} onChange={(e) => setForm({ ...form, marketing_opt_in: e.target.checked })} />
          Email me about new classes and events
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button className="btn-primary" disabled={busy}>{busy && <Spinner />}Save details</button>
        </div>
      </form>
      {profile?.role !== 'customer' && <p className="mt-2 text-xs text-muted">Account role: {profile?.role}</p>}
    </section>
  );
}

/** Asks existing members (who joined before it was required) for their date of birth, once. */
