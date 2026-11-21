import { isUnlimited } from '../domain/plans';
import { useBackToClose } from '../lib/useBackToClose';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MemberMatch, RosterEntry } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { supabase, AppError } from '../lib/supabase';
import { unwrap } from '../api';
import { fmt, ordinal } from '../domain/time';
import { Avatar } from './Avatar';
import QRCode from 'qrcode';
import { ALERT_REASON, checkin, type CheckInAlert } from '../lib/checkin';
import { Celebration } from './Celebration';
import { MemberPhotoButton } from './MemberPhotoButton';
import { CancelSessionSheet, EditSessionSheet } from './SessionAdminSheets';
import { ErrorNotice, Notice, PageSpinner, Sheet, Spinner, useToast } from './ui';

const KIND_LABEL: Record<RosterEntry['kind'], string> = { membership: 'Membership', drop_in: 'Drop In', ticket: 'Ticket', staff: 'Instructor · free' };
const STATUS_LABEL: Record<string, string> = {
  booked: 'Booked', attended: 'Attended', no_show: 'No-show', pending_payment: 'Paying now…',
};

/**
 * Class list for instructors and admins: who's coming (with photo), who is new,
 * whose birthday it is, attendance, and adding a member who's at the door.
 */
export function StaffRoster({ sessionId, onClose, onChanged, isAdmin = false, startWithQr = false }: {
  sessionId: string;
  startWithQr?: boolean;
  onClose: () => void;
  onChanged?: () => void;
  isAdmin?: boolean;
}) {
  const toast = useToast();
  const roster = useAsync(() => api.roster(sessionId), [sessionId]);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [qr, setQr] = useState(startWithQr);
  const r = roster.data;
  const started = r ? new Date(r.starts_at).getTime() - 3_600_000 <= Date.now() : false;

  async function mark(b: RosterEntry, status: 'attended' | 'no_show') {
    try {
      await api.setAttendance(b.booking_id, b.status === status ? 'booked' : status);
      await roster.reload();
    } catch (e) {
      toast(e instanceof AppError ? e.message : (e as Error).message, 'error');
    }
  }

  async function cancel(b: RosterEntry) {
    const reason = window.prompt(`Reason for cancelling ${b.full_name}'s booking (recorded in the audit log):`);
    if (!reason?.trim()) return;
    const restore = b.kind === 'membership' ? window.confirm('Return the class to their membership?') : false;
    try {
      unwrap(await supabase.rpc('admin_cancel_booking', { p_booking_id: b.booking_id, p_reason: reason, p_restore: restore }));
      toast('Booking cancelled.');
      await roster.reload();
      onChanged?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const birthdays = r?.bookings.filter((b) => b.is_birthday) ?? [];
  const newcomers = r?.bookings.filter((b) => b.is_new) ?? [];

  return (
    <Sheet open onClose={onClose} title={r?.title ?? 'Class list'}>
      {roster.loading && !r ? <PageSpinner /> : roster.error ? <ErrorNotice error={roster.error} onRetry={roster.reload} /> : r && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-canvas p-4">
            <div>
              <p className="font-semibold">{fmt.weekdayLong(r.starts_at)} · {fmt.time(r.starts_at)}–{fmt.time(r.ends_at)}</p>
              <p className="text-sm text-ink-soft">{r.booked_count} of {r.capacity} booked{r.status === 'cancelled' ? ' · cancelled' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {birthdays.length > 0 && <span className="chip bg-accent-100 text-ink">🎂 {birthdays.length} birthday{birthdays.length > 1 ? 's' : ''}</span>}
              {newcomers.length > 0 && <span className="chip bg-brand-50 text-brand-700">{newcomers.length} new</span>}
            </div>
          </div>

          {r.status === 'scheduled' && started && new Date(r.ends_at) > new Date() && (
            <button className="btn-accent w-full text-lg" onClick={() => setQr(true)}>📲 Show check-in QR</button>
          )}
          {isAdmin && r.status === 'scheduled' && new Date(r.ends_at) > new Date() && (
            <div className="flex gap-2">
              <button className="btn-outline btn-sm flex-1" onClick={() => setEditing(true)}>Edit class</button>
              <button className="btn-ghost btn-sm flex-1 text-danger" onClick={() => setCancelling(true)}>Cancel class</button>
            </div>
          )}

          {birthdays.length > 0 && (
            <Notice tone="warn">
              🎂 It’s {birthdays.map((b) => `${b.full_name.split(' ')[0]}’s${b.turning ? ` ${ordinal(b.turning)}` : ''}`).join(' and ')} birthday today!
            </Notice>
          )}
          {!started && <p className="text-xs text-muted">Attendance can be marked from 1 hour before class.</p>}

          <ul className="divide-y divide-line">
            {r.bookings.length === 0 && <li className="py-4 text-sm text-muted">Nobody booked yet.</li>}
            {r.bookings.map((b) => (
              <li key={b.booking_id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar path={b.avatar_path} name={b.full_name} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{b.full_name}{b.guest_name && <span className="chip ml-2 bg-accent-100 align-middle text-xs text-ink">+1 friend: {b.guest_name}</span>}</p>
                  {(b.phone || b.email) && (
                    <p className="flex flex-wrap gap-x-3 text-xs">
                      {b.phone && <a className="font-semibold text-brand-700" href={`tel:${b.phone.replace(/\s/g, '')}`}>📞 {b.phone}</a>}
                      {b.email && <a className="truncate text-brand-700" href={`mailto:${b.email}`}>{b.email}</a>}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {b.is_new && <span className="chip bg-brand-600 text-white">New · first class</span>}
                    {b.is_birthday && <span className="chip bg-accent-500 text-ink">🎂 Birthday{b.turning ? ` · ${b.turning}` : ''}</span>}
                    <span className="text-muted">{b.kind === 'membership' && b.plan_name ? b.plan_name : KIND_LABEL[b.kind]} · {STATUS_LABEL[b.status] ?? b.status}</span>
                  </div>
                  {!b.avatar_path && b.kind !== 'staff' && (
                    <div className="mt-1.5"><MemberPhotoButton memberId={b.user_id} name={b.full_name} hasPhoto={false} onSaved={() => void roster.reload()} className="btn-accent btn-sm" /></div>
                  )}
                </div>
                {b.status !== 'pending_payment' && (
                  <div className="flex gap-1">
                    {started && (
                      <>
                        <button className={`btn-sm btn ${b.status === 'attended' ? 'bg-success text-white' : 'btn-ghost'}`} onClick={() => void mark(b, 'attended')}>Here</button>
                        <button className={`btn-sm btn ${b.status === 'no_show' ? 'bg-ink text-white' : 'btn-ghost'}`} onClick={() => void mark(b, 'no_show')}>No-show</button>
                      </>
                    )}
                    {isAdmin && b.status === 'booked' && <button className="btn-sm btn-ghost text-danger" onClick={() => void cancel(b)}>Cancel</button>}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {r.status === 'scheduled' && new Date(r.ends_at) > new Date() && (
            <AddMember sessionId={sessionId} onAdded={() => { void roster.reload(); onChanged?.(); }} />
          )}
        </div>
      )}
      {qr && r && <CheckInScreen sessionId={sessionId} title={r.title} onClose={() => { setQr(false); void roster.reload(); onChanged?.(); }} />}
      {editing && <EditSessionSheet sessionId={sessionId} onClose={() => setEditing(false)}
        onDone={(n) => { toast(n ? `Class updated. ${n} member(s) notified.` : 'Class updated.'); void roster.reload(); onChanged?.(); }} />}
      {cancelling && r && <CancelSessionSheet session={{ id: sessionId, title: r.title, starts_at: r.starts_at, booked_count: r.booked_count }} onClose={() => setCancelling(false)}
        onDone={(n) => { toast(`Class cancelled. ${n} member(s) notified and given their class back.`); void roster.reload(); onChanged?.(); }} />}
    </Sheet>
  );
}

/** Search a member and book them into this class with their membership. */
function AddMember({ sessionId, onAdded }: { sessionId: string; onAdded: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<MemberMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      api.findMembers(term)
        .then((r) => live && setResults(r))
        .catch(() => live && setResults([]))
        .finally(() => live && setSearching(false));
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  async function add(m: MemberMatch) {
    setBusyId(m.id);
    setError(null);
    try {
      const res = await api.staffBook(sessionId, m.id);
      toast(`${m.full_name} booked in · ${isUnlimited(res.classes_remaining) ? 'unlimited plan' : `${res.classes_remaining} ${res.classes_remaining === 1 ? 'class' : 'classes'} left`}.`);
      setQ('');
      onAdded();
    } catch (e) {
      setError(e instanceof AppError ? `${m.full_name}: ${e.message}` : (e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line p-4">
      <h3 className="font-bold">Add a member</h3>
      <p className="text-xs text-muted">Uses one class from their membership, as if they booked themselves.</p>
      <input className="input mt-3" placeholder="Search by name, email or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <ul className="mt-2 divide-y divide-line">
        {searching && <li className="py-3 text-center text-brand-600"><Spinner /></li>}
        {!searching && q.trim().length >= 2 && results.length === 0 && <li className="py-3 text-sm text-muted">No members found.</li>}
        {results.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar path={m.avatar_path} name={m.full_name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.full_name || '—'}</p>
              <p className="truncate text-xs text-muted">{[m.email, m.phone].filter(Boolean).join(' · ')}</p>
            </div>
            <button className="btn-sm btn-primary" disabled={busyId !== null} onClick={() => void add(m)}>
              {busyId === m.id && <Spinner />}Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Full-screen QR for members to scan (new code every 30 seconds), with arrivals as they check in. */
function CheckInScreen({ sessionId, title, onClose }: { sessionId: string; title: string; onClose: () => void }) {
  useBackToClose(onClose);
  const [img, setImg] = useState<string | null>(null);
  const [left, setLeft] = useState(30);
  const [alerts, setAlerts] = useState<CheckInAlert[]>([]);
  const [alarm, setAlarm] = useState<CheckInAlert | null>(null);
  const [arrived, setArrived] = useState<RosterEntry[]>([]);
  const [shout, setShout] = useState<RosterEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const c = await checkin.code(sessionId);
        if (!live) return;
        setImg(await QRCode.toDataURL(checkin.url(sessionId, c.code), { width: 720, margin: 1, errorCorrectionLevel: 'M' }));
        setLeft(c.valid_for); setError(null);
        timer = setTimeout(refresh, Math.max(2, c.valid_for) * 1000);
      } catch (e) { if (live) { setError((e as Error).message); timer = setTimeout(refresh, 5000); } }
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, [sessionId]);
  useEffect(() => { const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(t); }, []);
  // Scans that didn't go through: shown in red until that person is checked in.
  useEffect(() => {
    let seen: Set<number> | null = null;
    const poll = async () => {
      try {
        const list = await checkin.alerts(sessionId);
        if (seen) { const fresh = list.find((a) => !seen!.has(a.id)); if (fresh) { setAlarm(fresh); setTimeout(() => setAlarm((x) => (x === fresh ? null : x)), 8000); } }
        seen = new Set(list.map((a) => a.id));
        setAlerts(list);
      } catch { /* keep showing the code */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, []);
  // Who has checked in (polled every 4 seconds); the newest arrival gets a moment on screen.
  useEffect(() => {
    let seen: Set<string> | null = null;
    const poll = async () => {
      try {
        const r = await api.roster(sessionId);
        const here = r.bookings.filter((b) => b.status === 'attended');
        if (seen) { const fresh = here.find((b) => !seen!.has(b.booking_id)); if (fresh) { setShout(fresh); setTimeout(() => setShout((x) => (x === fresh ? null : x)), 6000); } }
        seen = new Set(here.map((b) => b.booking_id));
        setArrived(here);
      } catch { /* keep showing the code */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, [sessionId]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-ink p-4 text-white">
      {shout?.is_birthday && <Celebration emojis={['🎂', '🎉', '🎈']} count={40} />}
      <div className="flex w-full max-w-md items-center justify-between">
        <button className="flex items-center gap-1 rounded-full bg-white/15 px-4 py-2 font-semibold text-white hover:bg-white/25" onClick={onClose}>← Back</button>
        <p className="font-bold text-right">{title} · check-in</p>
      </div>
      <div className="mt-4 w-full max-w-md rounded-3xl bg-white p-4">
        {img ? <img src={img} alt="Check-in QR code" className="w-full" /> : <div className="aspect-square w-full animate-pulse rounded-2xl bg-canvas" />}
      </div>
      <p className="mt-3 text-center text-white/80">Members: open your phone camera and scan to check in.<br /><span className="text-xs">New code in {left}s{error ? ' · reconnecting…' : ''}</span></p>
      {shout && (
        <div className={`mt-4 w-full max-w-md rounded-2xl p-4 text-center ${shout.is_birthday ? 'bg-accent-500 text-ink' : shout.is_new ? 'bg-brand-600' : 'bg-success'}`}>
          <p className="text-2xl font-black">{shout.is_birthday ? '🎂 ' : shout.is_new ? '✨ ' : '✅ '}{shout.full_name}</p>
          <p className="font-semibold">{shout.is_birthday ? `It’s their birthday${shout.turning ? ` (${shout.turning})` : ''}! Sing it! 🎉` : shout.is_new ? 'FIRST CLASS: say hi and make them welcome!' : 'Checked in'}</p>
        </div>
      )}
      {alarm && (
        <div className="mt-4 w-full max-w-md rounded-2xl bg-danger p-4 text-center">
          <p className="text-2xl font-black">⚠️ {alarm.full_name}</p>
          <p className="font-semibold">{ALERT_REASON[alarm.reason] ?? 'couldn’t check in'}{alarm.reason === 'checkin_not_booked' ? '. Their phone offers to book now.' : ''}</p>
        </div>
      )}
      {alerts.length > 0 && (
        <div className="mt-4 w-full max-w-md rounded-2xl border-2 border-danger/70 bg-danger/15 p-3">
          <p className="text-sm font-bold">⚠️ Scanned but not checked in ({alerts.length})</p>
          <ul className="mt-1 space-y-1 text-sm">
            {alerts.map((a) => <li key={a.id}><strong>{a.full_name}</strong> {ALERT_REASON[a.reason] ?? 'couldn’t check in'}{a.title ? ` (${a.title})` : ''}</li>)}
          </ul>
        </div>
      )}
      <div className="mt-4 w-full max-w-md">
        <p className="text-sm font-semibold text-white/70">Here ({arrived.length})</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {arrived.map((b) => <li key={b.booking_id} className="chip bg-white/10 text-white">{b.is_birthday ? '🎂 ' : b.is_new ? '✨ ' : ''}{b.full_name}</li>)}
        </ul>
      </div>
      <button className="btn mt-6 w-full max-w-md border-2 border-white/30 text-white hover:bg-white/10" onClick={onClose}>← Back to class list</button>
    </div>
  );
}
