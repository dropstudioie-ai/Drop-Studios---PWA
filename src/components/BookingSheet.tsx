import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { BookingOptions, ClassSession } from '../api/types';
import { AppError } from '../lib/supabase';
import { cancellationOutcome, cutoffLabel, spotsLeft } from '../domain/booking';
import { messageFor } from '../domain/messages';
import { fmt } from '../domain/time';
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
  const [opts, setOpts] = useState<BookingOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membershipId, setMembershipId] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

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
      })
      .catch((e) => live && setError((e as Error).message))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [session]);

  if (!session) return null;
  const start = new Date(session.starts_at);
  const eligible = opts?.memberships?.filter((m) => !m.issue) ?? [];
  const blocking = opts?.memberships?.find((m) => m.issue && !DEAD_ISSUES.has(m.issue)) ?? opts?.memberships?.find((m) => m.issue);
  const policy = {
    booking_window_days: 21,
    cancellation_cutoff_minutes: opts?.cancellation_cutoff_minutes ?? 30,
    late_cancel_restores_class: opts?.late_cancel_restores_class ?? false,
  };
  const cancelInfo = cancellationOutcome(start, new Date(), policy);

  async function book() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.book(session!.id, membershipId);
      toast(`Booked! ${res.classes_remaining} ${res.classes_remaining === 1 ? 'class' : 'classes'} left.`);
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof AppError ? e.message : messageFor(null));
      // Refresh options so the explanation and alternatives are current.
      api.bookingOptions(session!.id).then(setOpts).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!opts?.my_booking_id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.cancel(opts.my_booking_id);
      toast(res.class_restored ? 'Booking cancelled. Your class has been returned.' : 'Booking cancelled. This late cancellation used the class.', res.class_restored ? 'success' : 'info');
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof AppError ? e.message : messageFor(null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={session.title}>
      <div className="space-y-1 text-ink-soft">
        <p className="font-semibold text-ink">{fmt.weekdayLong(start)} · {fmt.time(start)}–{fmt.time(session.ends_at)}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          {session.style && <span className="chip text-white" style={{ background: session.style.color }}>{session.style.name}</span>}
          {session.instructor && <span>with {session.instructor.full_name}</span>}
          {session.level && <span>· {session.level}</span>}
          {session.room && <span>· {session.room}</span>}
        </p>
        {session.status === 'scheduled' && (
          <p className="text-sm">{spotsLeft(session) > 0 ? `${spotsLeft(session)} of ${session.capacity} spots left` : 'Class full'}</p>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {session.status === 'cancelled' && <Notice tone="warn">This class has been cancelled{session.cancel_reason ? `: ${session.cancel_reason}` : '.'}</Notice>}
        {session.is_special && <Notice tone="info">Special event — not included in memberships. Contact the studio for tickets.</Notice>}
        {loading && <div className="flex justify-center py-4 text-brand-600"><Spinner className="h-6 w-6" /></div>}
        {error && <ErrorNotice error={error} />}

        {opts && !opts.authenticated && session.status === 'scheduled' && (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft">Log in or create an account to book this class.</p>
            <Link to={`/login?next=${encodeURIComponent('/timetable')}`} className="btn-primary w-full">Log in to book</Link>
            <Link to="/register" className="btn-outline w-full">Create an account</Link>
          </div>
        )}

        {opts?.authenticated && opts.my_booking_id && (
          <div className="space-y-3">
            <Notice tone="success"><strong>You’re booked in.</strong> See you on the floor!</Notice>
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
                {cancelInfo.restores
                  ? <Notice tone="info">You’ll get this class back on your membership.</Notice>
                  : <Notice tone="warn">It’s less than {cutoffLabel(policy.cancellation_cutoff_minutes)} before class. If you cancel now, you <strong>won’t</strong> get this class back.</Notice>}
                <div className="flex gap-2">
                  <button className="btn-ghost flex-1" onClick={() => setConfirmCancel(false)}>Keep booking</button>
                  <button className="btn-danger flex-1" disabled={busy} onClick={cancel}>{busy && <Spinner />}Yes, cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {opts?.authenticated && !opts.my_booking_id && opts.session_issue && session.status === 'scheduled' && (
          <Notice tone="warn">{messageFor(opts.session_issue)}</Notice>
        )}

        {opts?.authenticated && !opts.my_booking_id && !opts.session_issue && eligible.length > 0 && (
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

        {opts?.authenticated && !opts.my_booking_id && !opts.session_issue && eligible.length === 0 && (
          <div className="space-y-3">
            <Notice tone="warn">{blocking ? messageFor(blocking.issue) : 'You need a membership to book classes.'}</Notice>
            <Link to="/memberships" className="btn-accent w-full">Explore memberships</Link>
          </div>
        )}

        {opts?.authenticated && !opts.my_booking_id && (opts.alternatives?.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">Classes you can book instead</p>
            <ul className="space-y-2">
              {opts.alternatives!.map((a) => (
                <li key={a.id}>
                  <button className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left text-sm hover:border-brand-400" onClick={() => onOpenSession(a.id)}>
                    <span><span className="font-semibold">{a.title}</span><br /><span className="text-muted">{fmt.dateTime(a.starts_at)}</span></span>
                    <span className="text-xs text-muted">{a.spots_left} spots</span>
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
