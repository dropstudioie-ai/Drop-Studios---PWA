import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import type { BookingOptions, ClassSession } from '../api/types';
import { AppError } from '../lib/supabase';
import { checkout, paymentsMode } from '../lib/payments';
import { availabilityLabel, cancellationOutcome, cutoffLabel } from '../domain/booking';
import { formatPrice } from '../domain/money';
import { messageFor } from '../domain/messages';
import { fmt } from '../domain/time';
import { renewalLink, renewalOffer, type RenewalOffer } from '../domain/renewal';
import { useAuth } from '../auth/AuthProvider';
import { ClockIcon, UserIcon } from './icons';
import { ErrorNotice, Notice, Sheet, Spinner, useToast } from './ui';

interface Props {
  session: ClassSession | null;
  onClose: () => void;
  onChanged: () => void;
  onOpenSession: (id: string) => void;
}

const DEAD_ISSUES = new Set(['membership_expired', 'no_classes_left', 'membership_cancelled']);

export function BookingSheet({ session, onClose, onChanged, onOpenSession }: Props) {
  const toast = useToast();
  const navigate = useNavigate();
  const [opts, setOpts] = useState<BookingOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [renewal, setRenewal] = useState<RenewalOffer | null>(null);
  const auth = useAuth();
  const userId = auth.session?.user.id;
  const isStaff = auth.isStaff;
  const [staffFree, setStaffFree] = useState(false);
  // One key per opened class: retries reuse the same ticket payment.
  const ticketKey = useMemo(() => crypto.randomUUID(), [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session) return;
    let live = true;
    setOpts(null);
    setError(null);
    setConfirmCancel(false);
    setLoading(true);
    api.bookingOptions(session.id)
      .then((o) => {
        if (!live) return;
        setOpts(o);
        setMembershipId(o.eligible_membership_id ?? null);
        setRenewal(null);
        setStaffFree(false);
        if (isStaff && o.my_booking_id) api.isStaffFreeBooking(o.my_booking_id).then((v) => live && setStaffFree(v)).catch(() => {});
        // All classes used? Offer to renew early (same plan) next to the Drop In.
        if (userId && o.memberships?.some((m) => m.issue === 'no_classes_left') && !o.memberships.some((m) => !m.issue)) {
          Promise.all([api.myMemberships(userId), api.plans()])
            .then(([ms, plans]) => live && setRenewal(renewalOffer(ms, plans)))
            .catch(() => {});
        }
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [session, userId, isStaff]);

  if (!session) return null;
  const start = new Date(session.starts_at);
  const ticketPrice = session.is_special ? (opts?.ticket_price_cents ?? session.ticket_price_cents) : null;
  const eligible = opts?.memberships?.filter((m) => !m.issue) ?? [];
  const blocking = opts?.memberships?.find((m) => m.issue && !DEAD_ISSUES.has(m.issue)) ?? opts?.memberships?.find((m) => m.issue);
  const policy = {
    booking_window_days: 21,
    cancellation_cutoff_minutes: opts?.cancellation_cutoff_minutes ?? 30,
    late_cancel_restores_class: opts?.late_cancel_restores_class ?? false,
  };
  const cancelInfo = cancellationOutcome(start, new Date(), policy);
  const scheduled = session.status === 'scheduled';
  const free = Boolean(opts?.authenticated && !opts.my_booking_id && !opts.pending_hold_booking_id);
  const dropInPrice = session.is_special ? null : (opts?.drop_in_price_cents ?? null);
  // Booking needs a profile photo (enforced by the server too).
  const needsPhoto = Boolean(free && opts?.has_profile_photo === false);
  // Instructors and admins book themselves in for free; members' options are hidden for them.
  const staffMode = Boolean(isStaff && free && session.status === 'scheduled');
  const canAct = free && !needsPhoto && !staffMode;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(e instanceof AppError ? e.message : messageFor(code ?? (e as Error).message));
      api.bookingOptions(session!.id).then(setOpts).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  const book = () => run(async () => {
    const res = await api.book(session.id, membershipId);
    toast(`Booked! ${res.classes_remaining} ${res.classes_remaining === 1 ? 'class' : 'classes'} left.`);
    onChanged();
    onClose();
  });

  const bookFree = () => run(async () => {
    await api.staffBookSelf(session.id);
    toast('Booked in, free (instructor).');
    onChanged();
    onClose();
  });

  const cancel = () => run(async () => {
    const res = await api.cancel(opts!.my_booking_id!);
    if (staffFree) { toast('Booking cancelled. Your spot has been released.'); onChanged(); onClose(); return; }
    toast(res.class_restored ? 'Booking cancelled. Your class has been returned.' : 'Booking cancelled. This late cancellation used the class.', res.class_restored ? 'success' : 'info');
    onChanged();
    onClose();
  });

  const buyTicket = () => run(async () => {
    const next = await checkout({ session_id: session.id, idempotency_key: ticketKey });
    if ('redirect' in next) window.location.assign(next.redirect);
    else navigate(next.navigate);
  });

  const releaseHold = () => run(async () => {
    await api.cancel(opts!.pending_hold_booking_id!);
    toast('Spot released.', 'info');
    onChanged();
    onClose();
  });

  return (
    <Sheet open onClose={onClose} title={session.title}>
      <div className="-mt-2 rounded-2xl bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-2">
          {session.style && <span className="chip text-white" style={{ background: session.style.color }}>{session.style.name}</span>}
          {session.is_special && <span className="chip bg-accent-500 text-ink">Special event</span>}
          {session.level && <span className="chip bg-white text-ink-soft">{session.level}</span>}
        </div>
        <p className="mt-3 flex items-center gap-2 font-semibold text-ink">
          <ClockIcon width={18} height={18} className="shrink-0 text-brand-600" />
          {fmt.weekdayLong(start)} · {fmt.time(start)}–{fmt.time(session.ends_at)}
        </p>
        {session.instructor && (
          <p className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
            <UserIcon width={18} height={18} className="shrink-0 text-muted" />with {session.instructor.full_name}{session.room ? ` · ${session.room}` : ''}
          </p>
        )}
        {scheduled && availabilityLabel(session.availability) && (
          <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-bold ${session.availability === 'full' ? 'bg-ink/10 text-ink-soft' : 'bg-accent-100 text-ink'}`}>
            {availabilityLabel(session.availability)}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {!scheduled && <Notice tone="warn">This class has been cancelled{session.cancel_reason ? `: ${session.cancel_reason}` : '.'}</Notice>}
        {loading && <div className="flex justify-center py-4 text-brand-600"><Spinner className="h-6 w-6" /></div>}
        {error && <ErrorNotice error={error} />}

        {opts && !opts.authenticated && scheduled && (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">
              {ticketPrice != null ? `Tickets are ${formatPrice(ticketPrice)}. ` : ''}
              {dropInPrice != null ? `Drop In ${formatPrice(dropInPrice)}, or use a membership. ` : ''}
              Log in or create an account to {ticketPrice != null ? 'buy a ticket' : 'book this class'}.
            </p>
            <Link to={`/login?next=${encodeURIComponent('/timetable')}`} className="btn-primary w-full">Log in</Link>
            <Link to="/register" className="btn-outline w-full">Create an account</Link>
          </div>
        )}

        {/* Already booked */}
        {opts?.authenticated && opts.my_booking_id && (
          <div className="space-y-3">
            <Notice tone="success"><strong>{opts.my_booking_is_ticket ? (session.is_special ? 'You have a ticket.' : 'You’re booked in (Drop In).') : staffFree ? 'You’re booked in (instructor, free).' : 'You’re booked in.'}</strong> See you on the floor!</Notice>
            {opts.my_booking_is_ticket ? (
              <p className="text-sm text-muted">Can’t make it? Contact the studio about your booking.</p>
            ) : (
              <>
                {cancelInfo.allowed && !confirmCancel && (
                  <>
                    <p className="text-sm text-muted">
                      Free cancellation until {fmt.time(new Date(start.getTime() - policy.cancellation_cutoff_minutes * 60_000))} ({cutoffLabel(policy.cancellation_cutoff_minutes)} before class).
                    </p>
                    <button className="btn-danger w-full" onClick={() => setConfirmCancel(true)}>Cancel booking</button>
                  </>
                )}
                {confirmCancel && (
                  <div className="space-y-3">
                    {staffFree ? <Notice tone="info">Your free spot will be released for someone else.</Notice> : cancelInfo.restores
                      ? <Notice tone="info">You’ll get this class back on your membership.</Notice>
                      : <Notice tone="warn">It’s less than {cutoffLabel(policy.cancellation_cutoff_minutes)} before class. If you cancel now, you <strong>won’t</strong> get this class back.</Notice>}
                    <div className="flex gap-2">
                      <button className="btn-ghost flex-1" onClick={() => setConfirmCancel(false)}>Keep booking</button>
                      <button className="btn-danger flex-1" disabled={busy} onClick={cancel}>{busy && <Spinner />}Yes, cancel</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Ticket checkout in progress */}
        {opts?.authenticated && opts.pending_hold_booking_id && (
          <div className="space-y-3">
            <Notice tone="warn">Your spot is held while you finish paying. Unpaid holds are released after about 30 minutes.</Notice>
            <button className="btn-accent w-full text-lg" disabled={busy} onClick={buyTicket}>{busy && <Spinner />}Continue to payment</button>
            <button className="btn-ghost w-full" disabled={busy} onClick={releaseHold}>Release my spot</button>
          </div>
        )}

        {/* Instructors and admins: free booking */}
        {opts && staffMode && (
          <div className="space-y-3">
            {opts.session_issue === 'session_full' && <Notice tone="warn">{messageFor('session_full')}</Notice>}
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-soft"><strong className="text-ink">Instructor booking</strong> · takes a spot, no charge</span>
              <span className="font-display text-2xl font-black">Free</span>
            </div>
            <button className="btn-primary w-full text-lg" disabled={busy || opts.session_issue === 'session_full'} onClick={bookFree}>
              {busy && <Spinner />}Book for free
            </button>
          </div>
        )}

        {needsPhoto && !staffMode && scheduled && !opts?.session_issue && (
          <div className="space-y-3">
            <Notice tone="warn">{messageFor('profile_photo_required')}</Notice>
            <Link to="/account#photo" className="btn-accent w-full">Add profile photo</Link>
          </div>
        )}

        {/* Special event: buy a ticket */}
        {opts && canAct && scheduled && session.is_special && (
          ticketPrice != null && !opts.session_issue ? (
            <div className="space-y-3">
              {paymentsMode === 'test' && <Notice tone="test"><strong>TEST MODE</strong> — no real payment will be taken.</Notice>}
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft">Ticket · one-off payment</span>
                <span className="font-display text-2xl font-black">{formatPrice(ticketPrice, 'EUR', { forceDecimals: true })}</span>
              </div>
              <button className="btn-accent w-full text-lg" disabled={busy} onClick={buyTicket}>
                {busy && <Spinner />}{paymentsMode === 'test' ? 'Get TEST ticket' : 'Buy ticket'}
              </button>
              <p className="text-center text-xs text-muted">Not included in memberships. Tickets are non-refundable unless the studio cancels the event.</p>
            </div>
          ) : (
            <Notice tone="warn">{opts.session_issue === 'session_full' ? messageFor('session_full') : messageFor('tickets_not_available')}</Notice>
          )
        )}

        {/* Regular class */}
        {opts && free && !staffMode && !session.is_special && opts.session_issue && scheduled && <Notice tone="warn">{messageFor(opts.session_issue)}</Notice>}

        {opts && canAct && !session.is_special && !opts.session_issue && eligible.length > 0 && (
          <div className="space-y-3">
            {eligible.length > 1 ? (
              <label className="block">
                <span className="label">Use membership</span>
                <select className="input" value={membershipId ?? ''} onChange={(e) => setMembershipId(e.target.value)}>
                  {eligible.map((m) => <option key={m.membership_id} value={m.membership_id}>{m.plan_name} — {m.classes_remaining} left</option>)}
                </select>
              </label>
            ) : (
              <p className="text-sm text-ink-soft">Uses 1 class from <strong>{eligible[0].plan_name}</strong> ({eligible[0].classes_remaining} left).</p>
            )}
            <button className="btn-primary w-full text-lg" disabled={busy} onClick={book}>{busy && <Spinner />}Book this class</button>
            <p className="text-center text-xs text-muted">Cancel at least {cutoffLabel(policy.cancellation_cutoff_minutes)} before to get the class back.</p>
          </div>
        )}

        {opts && canAct && !session.is_special && !opts.session_issue && eligible.length === 0 && (
          dropInPrice != null ? (
            <div className="space-y-3">
              {renewal ? (
                <>
                  <Notice tone="info">
                    You’ve used all the classes on your <strong>{renewal.planName}</strong>
                    {renewal.expiresAt ? ` (valid until ${fmt.date(renewal.expiresAt)})` : ''}. Renew it now, or pay for this class as a Drop In.
                  </Notice>
                  <Link to={renewalLink(renewal)} className="btn-primary w-full text-lg">
                    {renewal.plan ? `Renew early · ${formatPrice(renewal.plan.price_cents, renewal.plan.currency)}` : 'Choose a new membership'}
                  </Link>
                  {renewal.plan && <p className="text-center text-xs text-muted">{renewal.plan.name}: {renewal.plan.class_count} classes.</p>}
                  <p className="pt-1 text-center text-xs font-semibold uppercase tracking-wide text-muted">or</p>
                </>
              ) : blocking && <Notice tone="info">{messageFor(blocking.issue)} You can still come as a Drop In.</Notice>}
              {paymentsMode === 'test' && <Notice tone="test"><strong>TEST MODE</strong> — no real payment will be taken.</Notice>}
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-soft"><strong className="text-ink">Drop In</strong> · this class only</span>
                <span className="font-display text-2xl font-black">{formatPrice(dropInPrice, 'EUR', { forceDecimals: true })}</span>
              </div>
              <button className="btn-accent w-full text-lg" disabled={busy} onClick={buyTicket}>
                {busy && <Spinner />}{paymentsMode === 'test' ? 'Book TEST Drop In' : 'Book Drop In'}
              </button>
              {!renewal && <Link to="/memberships" className="btn-outline w-full">Save with a membership</Link>}
              <p className="text-center text-xs text-muted">Drop Ins aren’t refundable in the app. Contact the studio if you can’t make it.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Notice tone="warn">{blocking ? messageFor(blocking.issue) : 'You need a membership to book classes.'}</Notice>
              <Link to="/memberships" className="btn-accent w-full">Explore memberships</Link>
            </div>
          )
        )}

        {opts && free && (opts.alternatives?.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">Classes you can book instead</p>
            <ul className="space-y-2">
              {opts.alternatives!.map((a) => (
                <li key={a.id}>
                  <button className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left text-sm hover:border-brand-400" onClick={() => onOpenSession(a.id)}>
                    <span><span className="font-semibold">{a.title}</span><br /><span className="text-muted">{fmt.dateTime(a.starts_at)}</span></span>
                    {availabilityLabel(a.availability) && <span className="text-xs text-muted">{availabilityLabel(a.availability)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  );
}
