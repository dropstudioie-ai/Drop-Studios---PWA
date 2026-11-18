import { HALF_HOURS, rentals, STATUS_LABEL, toMinutes, type RentalBooking } from '../lib/rentals';
import { ClassDoorCode } from '../components/ClassDoorCode';
import { cancelRental, checkout } from '../lib/payments';
import { messageFor } from '../domain/messages';
import { downloadReceipt, myReceipts } from '../lib/receipts';
import { gifts } from '../lib/gifts';
import { UNLIMITED_CLASSES } from '../domain/plans';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { Booking, Membership } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { AppError } from '../lib/supabase';
import { NotificationSettings } from '../components/NotificationSettings';
import { useAuth } from '../auth/AuthProvider';
import { cancellationOutcome, cutoffLabel, DEFAULT_POLICY } from '../domain/booking';
import { fmt, localDateKey, zonedTime } from '../domain/time';
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
import { FeedbackPrompt } from './Feedback';
import { EmptyState, ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../components/ui';

const BOOKING_LABEL: Record<string, string> = {
  booked: 'Booked', pending_payment: 'Payment not completed', attended: 'Attended', no_show: 'No-show', cancelled: 'Cancelled', late_cancelled: 'Late cancellation',
};

export default function Account() {
  const { session, profile, signOut, refreshProfile, isStaff, isAdmin } = useAuth();
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
  const totalRemaining = current.filter((m) => m.state !== 'paused').reduce((s, m) => s + Math.min(m.classes_remaining, UNLIMITED_CLASSES), 0);

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
          <h1 className="text-3xl font-black">{isStaff ? 'My account' : 'My Membership'}</h1>
          {isStaff && <p className="mt-1 text-sm text-muted">{isAdmin ? 'Admin' : 'Instructor'} account · you book classes for free, no membership needed.</p>}
        </div>
        {!isStaff && current.length > 0 && <p className="font-display text-lg font-extrabold text-brand-700">{totalRemaining} {totalRemaining === 1 ? 'class' : 'classes'} available</p>}
      </div>

      <div className="mt-6 space-y-3">{!isStaff && <FeedbackPrompt />}<ProfilePhotoCard />{!profile?.date_of_birth && <BirthdayCard onSaved={refreshProfile} />}</div>

      {(!isStaff || current.length > 0 || liveSubs.length > 0) && <section className="mt-6 space-y-4" aria-labelledby="current-h">
        <h2 id="current-h" className="sr-only">Current memberships</h2>
        {!isStaff && out?.kind === 'subscription' && <OutOfClassesCard out={out} />}
        {liveSubs.map((s) => <SubscriptionCard key={s.id} sub={s} onChanged={() => void data.reload()} />)}
        {!isStaff && renewal && (
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
      </section>}

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
                <ClassDoorCode sessionId={b.session_id} className="mt-2" />
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

      <StudioBookings uid={uid} />
      <Receipts />
      <GiftsBought uid={uid} />
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

/** The front door code, shown once a booking is paid. */
function DoorCode({ bookingId }: { bookingId: string }) {
  const [code, setCode] = useState<string | null>(null);
  return code ? <p className="mt-2 rounded-xl bg-brand-50 p-2 text-sm">🔑 Front door code: <strong className="font-mono">{code}</strong> · Please keep the front door closed at all times.</p>
    : <button className="mt-2 text-sm font-semibold text-brand-700" onClick={async () => setCode((await rentals.access(bookingId).catch(() => null)) ?? 'Ask at reception')}>🔑 Show the front door code</button>;
}

/** The member's studio rentals: pay, reschedule (24h+ before) or cancel (refund 7+ days before). */
function StudioBookings({ uid }: { uid: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const list = useAsync(() => rentals.mine(uid), [uid]);
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState<RentalBooking | null>(null);
  const [day, setDay] = useState(''); const [time, setTime] = useState('10:00');
  const now = Date.now();
  const rows = (list.data ?? []).filter((b) => new Date(b.ends_at).getTime() > now - 864e5 && !['declined', 'expired', 'released', 'cancelled'].includes(b.status) || (b.status === 'cancelled' && new Date(b.starts_at).getTime() > now));
  if (!list.data?.length) return null;
  const hm = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
  // Unpaid bookings are paid together: a weekly series month by month, others one by one.
  const groups = new Map<string, RentalBooking[]>();
  for (const b of rows.filter((x) => (x.status === 'awaiting_payment' || x.status === 'held') && (!x.hold_expires_at || new Date(x.hold_expires_at).getTime() > now))) {
    const k = b.series_id ? `${b.series_id}:${b.month_key}` : b.id;
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const pay = async (ids: string[]) => {
    setBusy(ids[0]);
    try { const next = await checkout({ rental_booking_ids: ids, idempotency_key: crypto.randomUUID() }); if ('redirect' in next) window.location.href = next.redirect; else navigate(next.navigate); }
    catch (e) { toast(messageFor((e as { code?: string }).code ?? (e as Error).message), 'error'); setBusy(null); }
  };
  return (
    <section id="rentals" className="mt-10" aria-labelledby="rentals-h">
      <div className="flex items-center justify-between gap-2"><h2 id="rentals-h" className="text-xl font-black">Studio bookings</h2><Link to="/rent" className="btn-outline btn-sm">Book the studio</Link></div>
      {[...groups.values()].map((g) => (
        <div key={g[0].id} className="mt-3"><Notice tone="warn">
          <strong>{g[0].status === 'held' ? `Keep your weekly slot: ${g.length} date${g.length === 1 ? '' : 's'} next month` : `${g.length > 1 ? `${g.length} dates` : dayLabel(g[0].starts_at)} waiting for payment`}</strong>
          {g[0].hold_expires_at && <> · pay by {fmt.dateTime(g[0].hold_expires_at)}</>}
          <button className="btn-primary btn-sm ml-2" disabled={busy === g[0].id} onClick={() => void pay(g.map((x) => x.id))}>{busy === g[0].id ? <Spinner className="h-4 w-4" /> : `Pay ${formatPrice(g.reduce((n, x) => n + x.total_cents, 0), 'EUR')}`}</button>
        </Notice></div>
      ))}
      <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
        {rows.map((b) => {
          const hoursLeft = (new Date(b.starts_at).getTime() - now) / 3600e3;
          return (
            <li key={b.id} className="p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><span className="font-semibold">{dayLabel(b.starts_at)}, {hm(b.starts_at)}–{hm(b.ends_at)}</span>{b.is_party && ' 🎉'}{b.group_name && <span className="text-muted"> · {b.group_name}</span>}
                  <span className={`block text-xs ${b.status === 'confirmed' ? 'text-success' : 'text-muted'}`}>{STATUS_LABEL[b.status]}{b.refund_cents ? ` · refund ${formatPrice(b.refund_cents, 'EUR')} ${b.refund_status === 'refunded' ? 'sent' : b.refund_status === 'failed' ? 'failed (we’ll sort it)' : 'on its way'}` : ''}</span></span>
                {b.status !== 'cancelled' && hoursLeft > 0 && (
                  <span className="flex gap-2">
                    {hoursLeft >= 24 && b.status !== 'pending_approval' && <button className="btn-ghost btn-sm" onClick={() => { setMoving(b); setDay(localDateKey(new Date(b.starts_at))); setTime(hm(b.starts_at)); }}>Move</button>}
                    <button className="btn-ghost btn-sm text-danger" disabled={busy === b.id} onClick={async () => {
                      const refund = b.status === 'confirmed' && hoursLeft >= 24 * 7;
                      if (!confirm(b.status !== 'confirmed' ? 'Cancel this booking?' : refund ? `Cancel and get a full refund of ${formatPrice(b.total_cents, 'EUR')}?` : 'Cancel this booking? It’s less than 7 days away, so it can’t be refunded.')) return;
                      setBusy(b.id);
                      try { const r = await cancelRental(b.id); toast(r.refund_cents ? `Cancelled. ${formatPrice(r.refund_cents, 'EUR')} is being refunded to your card.` : 'Booking cancelled.'); list.reload(); }
                      catch (e) { toast(messageFor((e as { code?: string }).code ?? (e as Error).message), 'error'); } finally { setBusy(null); }
                    }}>Cancel</button>
                  </span>
                )}
              </div>
              {b.status === 'confirmed' && new Date(b.ends_at).getTime() > now && <DoorCode bookingId={b.id} />}
              {moving?.id === b.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl bg-canvas p-2">
                  <Field label="New day"><input className="input" type="date" min={localDateKey(new Date())} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
                  <Field label="From"><select className="input" value={time} onChange={(e) => setTime(e.target.value)}>{HALF_HOURS.map((h) => <option key={h}>{h}</option>)}</select></Field>
                  <button className="btn-primary btn-sm" disabled={busy === b.id} onClick={async () => {
                    setBusy(b.id);
                    try { await rentals.reschedule(b.id, zonedTime(day, toMinutes(time))); toast('Booking moved'); setMoving(null); list.reload(); }
                    catch (e) { toast(messageFor((e as Error).message), 'error'); } finally { setBusy(null); }
                  }}>Move it</button>
                  <button className="btn-ghost btn-sm" onClick={() => setMoving(null)}>Close</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Every payment the member made, each with a downloadable PDF receipt. */
function Receipts() {
  const { profile, session } = useAuth();
  const toast = useToast();
  const list = useAsync(() => myReceipts(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const rows = list.data ?? [];
  const shown = all ? rows : rows.slice(0, 5);
  return (
    <section className="mt-10" aria-labelledby="receipts-h">
      <h2 id="receipts-h" className="text-xl font-black">Payments &amp; receipts</h2>
      {list.loading && !list.data ? <p className="mt-2 text-sm text-muted">Loading…</p> : rows.length ? (
        <>
          <ul className="mt-3 divide-y divide-line rounded-2xl border border-line">
            {shown.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.description}{r.month && r.of ? ` · ${r.month} of ${r.of}` : ''}</span>
                  <span className="text-xs text-muted">{fmt.date(r.paid_at)} · {formatPrice(r.amount_cents, r.currency)}{r.status === 'refunded' ? ' · refunded' : ''} · no. {r.receipt_no}</span>
                </span>
                <button className="btn-outline btn-sm shrink-0" disabled={busy === r.id} onClick={async () => {
                  setBusy(r.id);
                  try { await downloadReceipt(r, { full_name: profile?.full_name ?? null, email: profile?.email ?? session?.user.email ?? null }); }
                  catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
                }}>{busy === r.id ? <Spinner className="h-4 w-4" /> : '⬇ Receipt'}</button>
              </li>
            ))}
          </ul>
          {rows.length > 5 && <button className="mt-2 text-sm font-semibold text-brand-700" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length} payments`}</button>}
        </>
      ) : <p className="mt-2 text-sm text-muted">Your payments will appear here, each with a receipt you can download.</p>}
    </section>
  );
}

/** Gift cards this member bought for others, with a link to each printable card. */
/** Send a gift card that hasn't been given yet (e.g. the free Black Friday gift) by email. */
function SendGift({ id, onSent }: { id: string; onSent: () => void }) {
  const toast = useToast();
  const today = localDateKey(new Date());
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', message: '', on: today });
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="mt-2 text-sm font-semibold text-brand-700" onClick={() => setOpen(true)}>✉️ Send it by email</button>;
  const send = async () => {
    setBusy(true);
    try { await gifts.send(id, f.name, f.email, f.message, f.on); toast(f.on === today ? 'Sent! 🎁' : `It will be emailed on ${f.on}`); onSent(); }
    catch (e) { toast(messageFor((e as Error).message), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      <input className="input" placeholder="Their name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" type="email" placeholder="Their email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      <input className="input sm:col-span-2" placeholder="Your message (optional)" value={f.message} maxLength={500} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <label className="text-sm">Send it on <input className="input" type="date" min={today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></label>
      <button className="btn-primary btn-sm self-end" disabled={busy || !f.email.trim()} onClick={() => void send()}>{busy ? <Spinner className="h-4 w-4" /> : 'Send gift'}</button>
    </div>
  );
}

function GiftsBought({ uid }: { uid: string }) {
  const list = useAsync(() => gifts.mine(uid), [uid]);
  return (
    <section id="gifts" className="mt-10 scroll-mt-20" aria-labelledby="gifts-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="gifts-h" className="text-xl font-black">Gift cards</h2>
        <div className="flex gap-2"><Link to="/gift/redeem" className="btn-ghost btn-sm">Redeem a code</Link><Link to="/gift" className="btn-outline btn-sm">🎁 Give one</Link></div>
      </div>
      {list.data?.length ? (
        <ul className="mt-3 space-y-2">
          {list.data.map((g) => (
            <li key={g.id} className="card p-3">
              <Link to={`/gift/card/${g.id}`} className="flex items-center justify-between gap-3">
                <span><span className="block font-semibold">{g.is_bonus ? '🎁 Free gift: ' : ''}{g.plan_snapshot.plan_name.replace(' (gift)', '').replace(' (free gift)', '')}{g.recipient_name ? ` for ${g.recipient_name}` : ''}</span>
                  <span className="text-xs text-muted">{g.status === 'redeemed' ? '✓ Redeemed' : g.recipient_email && !g.recipient_emailed_at ? `Email goes on ${g.send_on}` : g.recipient_emailed_at ? 'Sent by email' : g.collect_at_reception ? (g.collected_at ? 'Collected at reception' : 'Ready to collect at reception') : 'Not given yet'} · {g.code}{g.friend_free ? ' · 👯 brings a friend free' : ''}</span></span>
                <span className="text-sm font-semibold text-brand-700">View ›</span>
              </Link>
              {g.status === 'active' && !g.recipient_email && <SendGift id={g.id} onSent={list.reload} />}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-muted">A unique present for someone who loves to dance. Choose a pack and the day it arrives.</p>}
    </section>
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
