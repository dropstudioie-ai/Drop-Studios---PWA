import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { UpcomingBooking } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { fmt } from '../domain/time';
import { messageFor } from '../domain/messages';
import { ConfirmDialog, useToast } from './ui';

const classes = (n: number) => `${n} ${n === 1 ? 'class' : 'classes'}`;
const cutoffText = (mins: number) => (mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? '' : 's'}` : `${mins} minutes`);

type Pending =
  | { kind: 'cancel'; b: UpcomingBooking }
  | { kind: 'friend'; b: UpcomingBooking; name: string }
  | { kind: 'drop-friend'; b: UpcomingBooking; id: string; name: string };

/** Member home: the classes you're booked for, with your friends, "Bring a friend" and "Cancel". */
export function MyBookings() {
  const toast = useToast();
  const list = useAsync(() => api.myUpcoming(), []);
  const [adding, setAdding] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = list.data ?? [];
  if (!rows.length) return null;

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'cancel') {
        const r = await api.cancel(pending.b.booking_id);
        const n = pending.b.friends.length;
        toast(r.class_restored ? `Booking cancelled. ${n ? `Your ${classes(n + 1)} are` : 'Your class is'} back.` : 'Booking cancelled. This late cancellation used the class.', r.class_restored ? 'success' : 'info');
      } else if (pending.kind === 'friend') {
        const r = await api.addGuests(pending.b.booking_id, [pending.name]);
        toast(`${pending.name} is booked in with you! ${classes(r.classes_remaining)} left.`);
        setAdding(null); setName('');
      } else {
        const r = await api.cancelGuest(pending.id);
        toast(r.class_restored ? `${pending.name} removed. The class is back on your pack.` : `${pending.name} removed. Too late to get the class back.`, r.class_restored ? 'success' : 'info');
      }
      setPending(null);
      list.reload();
    } catch (e) {
      toast(messageFor((e as Error).message), 'error');
      setPending(null);
    } finally { setBusy(false); }
  };

  const late = pending?.b.late && !pending.b.late_restores;
  return (
    <section className="container-page pt-6" aria-labelledby="mine-h">
      <h2 id="mine-h" className="text-2xl font-black sm:text-3xl">You’re booked for</h2>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {rows.map((b) => (
          <li key={b.booking_id} className="card p-4">
            <div className="flex items-center gap-4">
              <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-white" style={{ background: b.color ?? '#1f43e6' }}>
                <span className="text-[10px] font-semibold uppercase">{fmt.weekdayShort(b.starts_at)}</span>
                <span className="font-display font-extrabold">{fmt.time(b.starts_at)}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{b.title}</span>
                <span className="text-sm text-muted">{fmt.date(b.starts_at)}{b.instructor ? ` · ${b.instructor}` : ''}</span>
              </span>
              <span className="chip bg-success/10 text-success">Booked ✓</span>
            </div>

            {b.friends.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {b.friends.map((f) => (
                  <li key={f.id} className="chip bg-accent-50 text-ink">
                    👯 {f.name}
                    <button className="ml-1 rounded-full px-1 font-bold text-muted hover:text-danger" aria-label={`Remove ${f.name}`} onClick={() => setPending({ kind: 'drop-friend', b, id: f.id, name: f.name })}>✕</button>
                  </li>
                ))}
              </ul>
            )}

            {adding === b.booking_id ? (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) setPending({ kind: 'friend', b, name: name.trim() }); }}>
                <input className="input min-w-0 flex-1" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Your friend’s name" maxLength={80} aria-label="Your friend’s name" />
                <button className="btn-primary" disabled={!name.trim()}>Add</button>
                <button type="button" className="btn-ghost" onClick={() => { setAdding(null); setName(''); }}>✕</button>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {b.can_add_friends && b.credits_left != null && (
                  <button className="btn-accent btn-sm" onClick={() => { setAdding(b.booking_id); setName(''); }}>
                    👯 Bring a friend · 1 class <span className="opacity-70">({classes(b.credits_left)} left)</span>
                  </button>
                )}
                {b.is_ticket
                  ? <Link to={`/timetable?class=${b.session_id}`} className="btn-outline btn-sm">Manage booking</Link>
                  : <button className="btn-outline btn-sm" onClick={() => setPending({ kind: 'cancel', b })}>Cancel booking</button>}
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog open={pending?.kind === 'cancel'} danger busy={busy} onConfirm={() => void run()} onClose={() => setPending(null)}
        title={`Cancel ${pending?.b.title ?? 'this class'}?`} confirmLabel="Yes, cancel booking">
        {pending && <>
          <p>{fmt.dateTime(pending.b.starts_at)}{pending.b.friends.length ? `, with ${pending.b.friends.map((f) => f.name).join(', ')}` : ''}.</p>
          <p className="mt-2">{late
            ? <strong>It’s less than {cutoffText(pending.b.cutoff_minutes)} before the class, so the {pending.b.friends.length ? 'classes are' : 'class is'} not returned.</strong>
            : `Your ${pending.b.friends.length ? classes(pending.b.friends.length + 1) + ' go' : 'class goes'} back on your pack.`}</p>
        </>}
      </ConfirmDialog>

      <ConfirmDialog open={pending?.kind === 'friend'} busy={busy} onConfirm={() => void run()} onClose={() => setPending(null)}
        title={pending?.kind === 'friend' ? `Bring ${pending.name}?` : ''} confirmLabel="Yes, book my friend">
        {pending?.kind === 'friend' && <p>{pending.name} joins you at {pending.b.title}, {fmt.dateTime(pending.b.starts_at)}. This uses <strong>1 class</strong> from your {pending.b.plan_name} ({classes((pending.b.credits_left ?? 1) - 1)} left after).</p>}
      </ConfirmDialog>

      <ConfirmDialog open={pending?.kind === 'drop-friend'} danger busy={busy} onConfirm={() => void run()} onClose={() => setPending(null)}
        title={pending?.kind === 'drop-friend' ? `Remove ${pending.name}?` : ''} confirmLabel="Yes, remove">
        {pending?.kind === 'drop-friend' && <p>{late ? <strong>It’s less than {cutoffText(pending.b.cutoff_minutes)} before the class, so this class is not returned.</strong> : 'Their spot is freed and the class goes back on your pack.'}</p>}
      </ConfirmDialog>
    </section>
  );
}
