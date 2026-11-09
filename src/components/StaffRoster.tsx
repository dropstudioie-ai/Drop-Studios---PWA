import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MemberMatch, RosterEntry } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { supabase, AppError } from '../lib/supabase';
import { unwrap } from '../api';
import { fmt, ordinal } from '../domain/time';
import { Avatar } from './Avatar';
import { ErrorNotice, Notice, PageSpinner, Sheet, Spinner, useToast } from './ui';

const KIND_LABEL: Record<RosterEntry['kind'], string> = { membership: 'Membership', drop_in: 'Drop In', ticket: 'Ticket', staff: 'Instructor · free' };
const STATUS_LABEL: Record<string, string> = {
  booked: 'Booked', attended: 'Attended', no_show: 'No-show', pending_payment: 'Paying now…',
};

/**
 * Class list for instructors and admins: who's coming (with photo), who is new,
 * whose birthday it is, attendance, and adding a member who's at the door.
 */
export function StaffRoster({ sessionId, onClose, onChanged, isAdmin = false }: {
  sessionId: string;
  onClose: () => void;
  onChanged?: () => void;
  isAdmin?: boolean;
}) {
  const toast = useToast();
  const roster = useAsync(() => api.roster(sessionId), [sessionId]);
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
                  <p className="font-semibold">{b.full_name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    {b.is_new && <span className="chip bg-brand-600 text-white">New · first class</span>}
                    {b.is_birthday && <span className="chip bg-accent-500 text-ink">🎂 Birthday{b.turning ? ` · ${b.turning}` : ''}</span>}
                    <span className="text-muted">{b.kind === 'membership' && b.plan_name ? b.plan_name : KIND_LABEL[b.kind]} · {STATUS_LABEL[b.status] ?? b.status}</span>
                  </div>
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
      toast(`${m.full_name} booked in · ${res.classes_remaining} ${res.classes_remaining === 1 ? 'class' : 'classes'} left.`);
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
      <input className="input mt-3" placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <ul className="mt-2 divide-y divide-line">
        {searching && <li className="py-3 text-center text-brand-600"><Spinner /></li>}
        {!searching && q.trim().length >= 2 && results.length === 0 && <li className="py-3 text-sm text-muted">No members found.</li>}
        {results.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2.5">
            <Avatar path={m.avatar_path} name={m.full_name} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{m.full_name || '—'}</p>
              <p className="truncate text-xs text-muted">{m.email}</p>
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
