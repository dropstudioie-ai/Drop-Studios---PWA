import { useEffect, useState } from 'react';
import { useBackToClose } from '../../lib/useBackToClose';
import QRCode from 'qrcode';
import { ALERT_REASON, checkin, type CheckInAlert } from '../../lib/checkin';
import { Celebration } from '../../components/Celebration';
import { supabase } from '../../lib/supabase';
import { api, unwrap } from '../../api';
import type { ClassTemplate, DanceStyle, Instructor, StaffSession } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { addDaysToKey, fmt, localDateKey, weekStartKey, zonedTime } from '../../domain/time';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { ErrorNotice, Field, PageSpinner, Sheet, Spinner, useToast } from '../../components/ui';
import { Section, Table, Td, WEEKDAYS } from './shared';
import { useFocus } from '../../lib/focus';
import { StaffRoster } from '../../components/StaffRoster';
import { CancelSessionSheet, EditSessionSheet } from '../../components/SessionAdminSheets';
import { holidays, range, type CoverNeeded } from '../../lib/holidays';
import { messageFor } from '../../domain/messages';

type TemplateForm = Omit<ClassTemplate, 'id'> & { id?: string };

const blankTemplate = (styleId: string): TemplateForm => ({
  title: '', style_id: styleId, instructor_id: null, weekday: 1, start_time: '18:00', duration_minutes: 60,
  capacity: 20, level: null, room: null, is_special: false, ticket_price_cents: null, is_active: true,
  valid_from: localDateKey(new Date()), valid_until: null,
});

export default function AdminTimetable() {
  const toast = useToast();
  const refs = useAsync(async () => {
    const [styles, instructors] = await Promise.all([
      unwrap(await supabase.from('dance_styles').select('*').order('sort_order')) as DanceStyle[],
      unwrap(await supabase.from('instructors').select('*').order('full_name')) as Instructor[],
    ]);
    return { styles, instructors };
  }, []);
  const templates = useAsync(async () =>
    unwrap(await supabase.from('class_templates').select('*').order('weekday').order('start_time')) as ClassTemplate[], []);

  const today = localDateKey(new Date());
  const [weekKey, setWeekKey] = useState(weekStartKey(today));
  const sessions = useAsync(() => api.staffSessions(zonedTime(weekKey).toISOString(), zonedTime(addDaysToKey(weekKey, 7)).toISOString()), [weekKey]);

  const [editing, setEditing] = useState<TemplateForm | null>(null);
  const [roster, setRoster] = useState<StaffSession | null>(null);
  const [cancelling, setCancelling] = useState<StaffSession | null>(null);
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [reception, setReception] = useState(false);
  const [newSession, setNewSession] = useState(false);
  const [busy, setBusy] = useState(false);

  if (refs.loading || templates.loading) return <PageSpinner />;
  if (refs.error) return <ErrorNotice error={refs.error} />;
  const { styles, instructors } = refs.data!;
  const styleName = (id: string) => styles.find((s) => s.id === id)?.name ?? '—';
  const instructorName = (id: string | null) => instructors.find((i) => i.id === id)?.full_name ?? '—';

  async function generate() {
    setBusy(true);
    try {
      const n = unwrap(await supabase.rpc('admin_generate_sessions', { p_from: today, p_to: addDaysToKey(today, 35) })) as number;
      toast(`${n} new classes added to the next 5 weeks.`);
      await sessions.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function applyToFuture(t: ClassTemplate) {
    try {
      const n = unwrap(await supabase.rpc('admin_apply_template_to_future', { p_template_id: t.id })) as number;
      toast(`Updated ${n} upcoming classes.`);
      await sessions.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <button className="btn-accent mb-4 w-full text-lg sm:w-auto" onClick={() => setReception(true)}>📲 Reception check-in QR (all classes)</button>
      {reception && <ReceptionCheckIn onClose={() => { setReception(false); void sessions.reload(); }} />}
      <InstructorHolidays instructors={refs.data?.instructors ?? []} onChanged={() => void sessions.reload()} />
      <Section title="Weekly timetable" actions={<>
        <button className="btn-sm btn-outline" onClick={() => setEditing(blankTemplate(styles[0]?.id ?? ''))} disabled={!styles.length}>Add recurring class</button>
        <button className="btn-sm btn-primary" onClick={generate} disabled={busy}>{busy && <Spinner />}Publish next 5 weeks</button>
      </>}>
        <p className="mb-3 text-sm text-muted">Recurring classes generate the bookable timetable. A daily job publishes 5 weeks ahead automatically when pg_cron is enabled. Editing a recurring class doesn’t change classes already published until you press “Apply to upcoming”.</p>
        <Table head={['Day', 'Time', 'Class', 'Style', 'Instructor', 'Spots', 'Status', '']} empty={!templates.data?.length}>
          {templates.data?.map((t) => (
            <tr key={t.id} className={t.is_active ? '' : 'opacity-50'}>
              <Td>{WEEKDAYS[t.weekday]}</Td>
              <Td>{t.start_time.slice(0, 5)} · {t.duration_minutes}m</Td>
              <Td><span className="font-semibold">{t.title}</span>{t.is_special && <span className="chip ml-1 bg-accent-50">Special{t.ticket_price_cents != null ? ` · ${formatPrice(t.ticket_price_cents)}` : ''}</span>}</Td>
              <Td>{styleName(t.style_id)}</Td>
              <Td>{instructorName(t.instructor_id)}</Td>
              <Td>{t.capacity}</Td>
              <Td>{t.is_active ? 'Active' : 'Inactive'}</Td>
              <Td className="whitespace-nowrap text-right">
                <button className="btn-sm btn-ghost" onClick={() => setEditing(t)}>Edit</button>
                <button className="btn-sm btn-ghost" onClick={() => void applyToFuture(t)}>Apply to upcoming</button>
              </Td>
            </tr>
          ))}
        </Table>
      </Section>

      <Section title="Published classes" actions={<>
        <button className="btn-sm btn-ghost" onClick={() => setWeekKey(addDaysToKey(weekKey, -7))}>← Prev</button>
        <span className="self-center text-sm font-semibold">Week of {fmt.date(zonedTime(weekKey))}</span>
        <button className="btn-sm btn-ghost" onClick={() => setWeekKey(addDaysToKey(weekKey, 7))}>Next →</button>
        <button className="btn-sm btn-outline" onClick={() => setNewSession(true)}>Add one-off class</button>
      </>}>
        {sessions.loading ? <PageSpinner /> : (
          <Table head={['When', 'Class', 'Instructor', 'Booked', 'Status', '']} empty={!sessions.data?.length}>
            {sessions.data?.map((s) => (
              <tr key={s.id} className={s.status === 'cancelled' ? 'opacity-50' : ''}>
                <Td className="whitespace-nowrap">{fmt.dateTime(s.starts_at)}</Td>
                <Td><span className="font-semibold">{s.title}</span> <span className="text-muted">· {s.style?.name}</span>{s.is_special && <span className="chip ml-1 bg-accent-50">Special{s.ticket_price_cents != null ? ` · ${formatPrice(s.ticket_price_cents)}` : ''}</span>}</Td>
                <Td>{s.instructor?.full_name ?? '—'}</Td>
                <Td className="tabular-nums">{s.booked_count}/{s.capacity}</Td>
                <Td>{s.status === 'cancelled' ? `Cancelled${s.cancel_reason ? `: ${s.cancel_reason}` : ''}` : 'Scheduled'}</Td>
                <Td className="whitespace-nowrap text-right">
                  <button className="btn-sm btn-ghost" onClick={() => setRoster(s)}>Roster</button>
                  {s.status === 'scheduled' && <button className="btn-sm btn-ghost" onClick={() => setEditingSession(s.id)}>Edit</button>}
                  {s.status === 'scheduled' && <button className="btn-sm btn-ghost text-danger" onClick={() => setCancelling(s)}>Cancel class</button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {editing && <TemplateSheet value={editing} styles={styles} instructors={instructors} onClose={() => setEditing(null)} onSaved={() => { toast('Saved.'); void templates.reload(); }} />}
      {newSession && <SessionSheet styles={styles} instructors={instructors} onClose={() => setNewSession(false)} onSaved={() => { toast('Class added.'); void sessions.reload(); }} />}
      {roster && <StaffRoster sessionId={roster.id} isAdmin onClose={() => setRoster(null)} onChanged={() => void sessions.reload()} />}
      {editingSession && <EditSessionSheet sessionId={editingSession} onClose={() => setEditingSession(null)} onDone={(n) => { toast(n ? `Class updated. ${n} member(s) notified.` : 'Class updated.'); void sessions.reload(); }} />}
      {cancelling && <CancelSessionSheet session={cancelling} onClose={() => setCancelling(null)} onDone={(n) => { toast(`Class cancelled. ${n} booking(s) cancelled and notified.`); void sessions.reload(); }} />}
    </>
  );
}

function TemplateSheet({ value, styles, instructors, onClose, onSaved }: {
  value: TemplateForm; styles: DanceStyle[]; instructors: Instructor[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<TemplateForm>(value);
  const [ticket, setTicket] = useState(value.ticket_price_cents != null ? (value.ticket_price_cents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TemplateForm>(k: K, v: TemplateForm[K]) => setF({ ...f, [k]: v });

  async function save() {
    const price = ticketPriceFrom(f.is_special, ticket);
    if (price === undefined) return setError('Enter a valid ticket price, e.g. 25 or 25.50, or leave it empty.');
    setBusy(true);
    setError(null);
    const { id, ...row } = f;
    const payload = { ...row, level: row.level || null, room: row.room || null, valid_until: row.valid_until || null, ticket_price_cents: price };
    const res = id
      ? await supabase.from('class_templates').update(payload).eq('id', id)
      : await supabase.from('class_templates').insert(payload);
    setBusy(false);
    if (res.error) setError(res.error.message);
    else { onSaved(); onClose(); }
  }

  return (
    <Sheet open onClose={onClose} title={f.id ? 'Edit recurring class' : 'Add recurring class'}>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Class name"><input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Heels Beginners" /></Field></div>
        <Field label="Style"><select className="input" value={f.style_id} onChange={(e) => set('style_id', e.target.value)}>{styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Instructor"><select className="input" value={f.instructor_id ?? ''} onChange={(e) => set('instructor_id', e.target.value || null)}><option value="">—</option>{instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}</select></Field>
        <Field label="Day"><select className="input" value={f.weekday} onChange={(e) => set('weekday', Number(e.target.value))}>{WEEKDAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></Field>
        <Field label="Start time"><input className="input" type="time" value={f.start_time.slice(0, 5)} onChange={(e) => set('start_time', e.target.value)} /></Field>
        <Field label="Duration (min)"><input className="input" type="number" min={15} max={480} value={f.duration_minutes} onChange={(e) => set('duration_minutes', Number(e.target.value))} /></Field>
        <Field label="Spots"><input className="input" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', Number(e.target.value))} /></Field>
        <Field label="Level"><input className="input" value={f.level ?? ''} onChange={(e) => set('level', e.target.value)} placeholder="All levels" /></Field>
        <Field label="Room"><input className="input" value={f.room ?? ''} onChange={(e) => set('room', e.target.value)} /></Field>
        <Field label="Runs from"><input className="input" type="date" value={f.valid_from} onChange={(e) => set('valid_from', e.target.value)} /></Field>
        <Field label="Until (optional)"><input className="input" type="date" value={f.valid_until ?? ''} onChange={(e) => set('valid_until', e.target.value || null)} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.is_special} onChange={(e) => set('is_special', e.target.checked)} />Special event (not bookable with memberships)</label>
        {f.is_special && <div className="col-span-2"><TicketPriceField value={ticket} onChange={setTicket} /></div>}
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} />Active</label>
      </div>
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <button className="btn-primary mt-4 w-full" disabled={busy || !f.title.trim()} onClick={save}>{busy && <Spinner />}Save</button>
    </Sheet>
  );
}

function SessionSheet({ styles, instructors, onClose, onSaved }: { styles: DanceStyle[]; instructors: Instructor[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ title: '', style_id: styles[0]?.id ?? '', instructor_id: '', date: localDateKey(new Date()), time: '18:00', duration: 60, capacity: 20, is_special: false, ticket: '' });
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const price = ticketPriceFrom(f.is_special, f.ticket);
    if (price === undefined) return setError('Enter a valid ticket price, e.g. 25 or 25.50, or leave it empty.');
    const [h, m] = f.time.split(':').map(Number);
    const starts = zonedTime(f.date, h * 60 + m);
    const { error } = await supabase.from('class_sessions').insert({
      title: f.title, style_id: f.style_id, instructor_id: f.instructor_id || null,
      starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + f.duration * 60_000).toISOString(),
      capacity: f.capacity, is_special: f.is_special, ticket_price_cents: price,
    });
    if (error) setError(error.message); else { onSaved(); onClose(); }
  }
  return (
    <Sheet open onClose={onClose} title="Add one-off class or workshop">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field></div>
        <Field label="Style"><select className="input" value={f.style_id} onChange={(e) => setF({ ...f, style_id: e.target.value })}>{styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Instructor"><select className="input" value={f.instructor_id} onChange={(e) => setF({ ...f, instructor_id: e.target.value })}><option value="">—</option>{instructors.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}</select></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Start (Dublin time)"><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
        <Field label="Duration (min)"><input className="input" type="number" value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} /></Field>
        <Field label="Spots"><input className="input" type="number" value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></Field>
        <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.is_special} onChange={(e) => setF({ ...f, is_special: e.target.checked })} />Special event / workshop (separate payment, not bookable with memberships)</label>
        {f.is_special && <div className="col-span-2"><TicketPriceField value={f.ticket} onChange={(ticket) => setF({ ...f, ticket })} /></div>}
      </div>
      {error && <div className="mt-3"><ErrorNotice error={error} /></div>}
      <button className="btn-primary mt-4 w-full" disabled={!f.title.trim()} onClick={save}>Add class</button>
    </Sheet>
  );
}



/** null = no online sales; undefined = invalid input. */
function ticketPriceFrom(isSpecial: boolean, input: string): number | null | undefined {
  if (!isSpecial || !input.trim()) return null;
  return parseEurosToCents(input) ?? undefined;
}

function TicketPriceField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Ticket price (€)" hint="Leave empty if tickets aren’t sold in the app.">
      <input className="input" inputMode="decimal" placeholder="e.g. 25" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Holiday requests from instructors, and the classes that need cover while they're away. */
function InstructorHolidays({ instructors, onChanged }: { instructors: Instructor[]; onChanged: () => void }) {
  const toast = useToast();
  const pending = useAsync(() => holidays.pending(), []);
  const cover = useAsync(() => holidays.needingCover(), []);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const reload = () => { pending.reload(); cover.reload(); onChanged(); };
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); reload(); } catch (e) { toast(messageFor((e as Error).message), 'error'); } finally { setBusy(null); }
  };
  const p = pending.data ?? [], c = cover.data ?? [];
  const focus = useFocus('holidays', p.length > 0);
  if (!p.length && !c.length) return null;
  const active = instructors.filter((i) => i.is_active);
  const replace = (x: CoverNeeded) => run(x.session_id, async () => unwrap(await supabase.rpc('admin_update_session', {
    p_session_id: x.session_id, p_starts_at: x.starts_at, p_ends_at: x.ends_at, p_instructor_id: pick[x.session_id], p_title: x.title, p_note: `${x.instructor} is on holiday`,
  })), 'Cover instructor set. Booked members have been told.');
  const cancel = (x: CoverNeeded) => {
    if (!confirm(`Cancel ${x.title} on ${fmt.dateTime(x.starts_at)}? ${x.booked_count ? `${x.booked_count} booked member(s) will be told and get their class back.` : 'Nobody is booked yet.'}`)) return;
    void run(x.session_id, async () => unwrap(await supabase.rpc('admin_cancel_session', { p_session_id: x.session_id, p_reason: `${x.instructor} is on holiday` })), 'Class cancelled');
  };
  return (
    <Section id="holidays" title="🌴 Instructor holidays" className={focus}>
      {p.length > 0 && (
        <ul className="space-y-3">
          {p.map((t) => (
            <li key={t.id} className="rounded-2xl border-2 border-accent-500 p-3">
              <p className="font-bold">{t.instructor?.full_name} asks for time off: {range(t.starts_on, t.ends_on)}</p>
              {t.note && <p className="text-sm text-muted">“{t.note}”</p>}
              <input className="input mt-2" placeholder="Optional note for them" value={notes[t.id] ?? ''} onChange={(e) => setNotes({ ...notes, [t.id]: e.target.value })} />
              <div className="mt-2 flex gap-2">
                <button className="btn-primary btn-sm" disabled={busy === t.id} onClick={() => void run(t.id, () => holidays.decide(t.id, true, notes[t.id] ?? ''), 'Approved. Now choose cover for their classes below.')}>Approve</button>
                <button className="btn-ghost btn-sm" disabled={busy === t.id} onClick={() => void run(t.id, () => holidays.decide(t.id, false, notes[t.id] ?? ''), 'Declined: they’ve been told')}>Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {c.length > 0 && (
        <>
          <p className="mt-4 text-sm font-semibold">Classes during approved holidays: choose a cover instructor or cancel</p>
          <ul className="mt-2 divide-y divide-line">
            {c.map((x) => (
              <li key={x.session_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{x.title}</strong> · {fmt.dateTime(x.starts_at)} · {x.instructor} away · {x.booked_count} booked</span>
                <span className="flex flex-wrap items-center gap-2">
                  <select className="input w-44" value={pick[x.session_id] ?? ''} onChange={(e) => setPick({ ...pick, [x.session_id]: e.target.value })}>
                    <option value="">Cover instructor…</option>
                    {active.filter((i) => i.id !== x.instructor_id).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                  </select>
                  <button className="btn-primary btn-sm" disabled={!pick[x.session_id] || busy === x.session_id} onClick={() => void replace(x)}>Replace</button>
                  <button className="btn-ghost btn-sm text-danger" disabled={busy === x.session_id} onClick={() => cancel(x)}>Cancel class</button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

type Arrival = { booking_id: string; full_name: string; title: string; is_new: boolean; is_birthday: boolean };

/** One QR at reception for every class on now (new code every 30 seconds), with arrivals as they check in. */
function ReceptionCheckIn({ onClose }: { onClose: () => void }) {
  useBackToClose(onClose);
  const [img, setImg] = useState<string | null>(null);
  const [left, setLeft] = useState(30);
  const [alerts, setAlerts] = useState<CheckInAlert[]>([]);
  const [alarm, setAlarm] = useState<CheckInAlert | null>(null);
  const [arrived, setArrived] = useState<Arrival[]>([]);
  const [shout, setShout] = useState<Arrival | null>(null);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const c = await checkin.studioCode();
        if (!live) return;
        setImg(await QRCode.toDataURL(checkin.studioUrl(c.code), { width: 720, margin: 1, errorCorrectionLevel: 'M' }));
        setLeft(c.valid_for);
        timer = setTimeout(refresh, Math.max(2, c.valid_for) * 1000);
      } catch { if (live) timer = setTimeout(refresh, 5000); }
    };
    void refresh();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { const t = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(t); }, []);
  // Scans that didn't go through: shown in red until that person is checked in.
  useEffect(() => {
    let seen: Set<number> | null = null;
    const poll = async () => {
      try {
        const list = await checkin.adminAlerts();
        if (seen) { const fresh = list.find((a) => !seen!.has(a.id)); if (fresh) { setAlarm(fresh); setTimeout(() => setAlarm((x) => (x === fresh ? null : x)), 8000); } }
        seen = new Set(list.map((a) => a.id));
        setAlerts(list);
      } catch { /* keep showing the code */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let seen: Set<string> | null = null;
    const poll = async () => {
      try {
        const here = await checkin.now();
        if (seen) { const fresh = here.find((b) => !seen!.has(b.booking_id)); if (fresh) { setShout(fresh); setTimeout(() => setShout((x) => (x === fresh ? null : x)), 6000); } }
        seen = new Set(here.map((b) => b.booking_id));
        setArrived(here);
      } catch { /* keep showing the code */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 4000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-ink p-4 text-white">
      {shout?.is_birthday && <Celebration emojis={['🎂', '🎉', '🎈']} count={40} />}
      <div className="flex w-full max-w-md items-center justify-between">
        <button className="flex items-center gap-1 rounded-full bg-white/15 px-4 py-2 font-semibold text-white hover:bg-white/25" onClick={onClose}>← Back</button>
        <p className="font-bold text-right">Drop check-in · all classes</p>
      </div>
      <div className="mt-4 w-full max-w-md rounded-3xl bg-white p-4">
        {img ? <img src={img} alt="Check-in QR code" className="w-full" /> : <div className="aspect-square w-full animate-pulse rounded-2xl bg-white/50" />}
      </div>
      <p className="mt-3 text-center text-white/80">Open the Drop app and tap <strong>📷 Check in</strong> (or scan with your phone camera).<br /><span className="text-xs">New code in {left}s</span></p>
      {shout && (
        <div className={`mt-4 w-full max-w-md rounded-2xl p-4 text-center ${shout.is_birthday ? 'bg-accent-500 text-ink' : shout.is_new ? 'bg-brand-600' : 'bg-success'}`}>
          <p className="text-2xl font-black">{shout.is_birthday ? '🎂 ' : shout.is_new ? '✨ ' : '✅ '}{shout.full_name}</p>
          <p className="font-semibold">{shout.title} · {shout.is_birthday ? 'It’s their birthday! 🎉' : shout.is_new ? 'FIRST CLASS: give them a warm welcome!' : 'Checked in'}</p>
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
        <p className="text-sm font-semibold text-white/70">Checked in now ({arrived.length})</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {arrived.map((b) => <li key={b.booking_id} className="chip bg-white/10 text-white">{b.is_birthday ? '🎂 ' : b.is_new ? '✨ ' : ''}{b.full_name} · {b.title}</li>)}
        </ul>
      </div>
      <button className="btn mt-6 w-full max-w-md border-2 border-white/30 text-white hover:bg-white/10" onClick={onClose}>← Back to timetable</button>
    </div>
  );
}
