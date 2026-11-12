import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { api, unwrap } from '../api';
import type { Instructor } from '../api/types';
import { fmt, localDateKey, zonedTime } from '../domain/time';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner } from './ui';

const hhmm = (iso: string) => fmt.time(iso);

/** Admin: change a dated class (date, time, length, instructor, name). Booked members are told. */
export function EditSessionSheet({ sessionId, onClose, onDone }: { sessionId: string; onClose: () => void; onDone: (notified: number) => void }) {
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [f, setF] = useState<{ title: string; date: string; start: string; end: string; instructor_id: string; note: string } | null>(null);
  const [booked, setBooked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const [list, s] = await Promise.all([
        api.instructors(),
        supabase.from('class_sessions').select('id, title, starts_at, ends_at, instructor_id').eq('id', sessionId).single(),
      ]);
      setInstructors(list);
      if (s.error) { setError(s.error.message); return; }
      const row = s.data as { title: string; starts_at: string; ends_at: string; instructor_id: string | null };
      setF({ title: row.title, date: localDateKey(new Date(row.starts_at)), start: hhmm(row.starts_at), end: hhmm(row.ends_at), instructor_id: row.instructor_id ?? '', note: '' });
      const roster = await api.roster(sessionId).catch(() => null);
      setBooked(roster?.bookings.filter((b) => b.status === 'booked').length ?? 0);
    })().catch((e) => setError((e as Error).message));
  }, [sessionId]);

  async function save() {
    if (!f) return;
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const starts = zonedTime(f.date, toMin(f.start));
    const ends = zonedTime(f.date, toMin(f.end));
    if (ends <= starts) { setError('The class has to end after it starts.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = unwrap(await supabase.rpc('admin_update_session', {
        p_session_id: sessionId, p_starts_at: starts.toISOString(), p_ends_at: ends.toISOString(),
        p_instructor_id: f.instructor_id || null, p_title: f.title, p_note: f.note || null,
      })) as { notified: number };
      onDone(r.notified);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title="Edit class">
      {!f ? (error ? <ErrorNotice error={error} /> : <PageSpinner />) : (
        <div className="space-y-3">
          <Field label="Class name"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts"><input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
            <Field label="Ends"><input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          </div>
          <Field label="Instructor">
            <select className="input" value={f.instructor_id} onChange={(e) => setF({ ...f, instructor_id: e.target.value })}>
              <option value="">To be confirmed</option>
              {instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
            </select>
          </Field>
          <Field label="Message to booked members (optional)">
            <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Sorry for the late change!" />
          </Field>
          <Notice tone="info">
            {booked === 0 ? 'Nobody is booked yet.' : `${booked} booked ${booked === 1 ? 'member gets' : 'members get'} an email and phone notification with the change. They stay booked and can cancel if they can’t make it.`}
          </Notice>
          {error && <ErrorNotice error={error} />}
          <button className="btn-primary w-full" disabled={busy || !f.title.trim()} onClick={() => void save()}>{busy && <Spinner />}Save changes</button>
          <p className="text-center text-xs text-muted">This changes this date only. To change it every week, edit the recurring class in Admin → Timetable.</p>
        </div>
      )}
    </Sheet>
  );
}

/** Admin: cancel a dated class. Everyone booked gets their class back and is told. */
export function CancelSessionSheet({ session, onClose, onDone }: {
  session: { id: string; title: string; starts_at: string; booked_count?: number };
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Cancel this class?">
      <p className="text-sm">{session.title} · {fmt.dateTime(session.starts_at)}</p>
      <div className="mt-3"><Notice tone="warn">
        {session.booked_count != null ? `All ${session.booked_count} booking(s)` : 'All bookings'} will be cancelled. Members get their class back (tickets and Drop Ins are flagged for a refund) and are notified by email and phone.
      </Notice></div>
      <div className="mt-3"><Field label="Reason (shown to members)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Instructor unwell" /></Field></div>
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <button className="btn-danger mt-4 w-full" disabled={!reason.trim() || busy} onClick={async () => {
        setBusy(true);
        try {
          const n = unwrap(await supabase.rpc('admin_cancel_session', { p_session_id: session.id, p_reason: reason })) as number;
          onDone(n);
          onClose();
        } catch (e) {
          setError((e as Error).message);
          setBusy(false);
        }
      }}>{busy && <Spinner />}Cancel class</button>
    </Sheet>
  );
}
