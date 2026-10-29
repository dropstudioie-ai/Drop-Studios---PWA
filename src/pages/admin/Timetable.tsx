import { useState } from 'react';
import { supabase, AppError } from '../../lib/supabase';
import { api, unwrap } from '../../api';
import type { Booking, ClassSession, ClassTemplate, DanceStyle, Instructor } from '../../api/types';
import { useAsync } from '../../lib/useAsync';
import { addDaysToKey, fmt, localDateKey, weekStartKey, zonedTime } from '../../domain/time';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../../components/ui';
import { Section, Table, Td, WEEKDAYS } from './shared';

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
  const sessions = useAsync(() => api.sessions(zonedTime(weekKey).toISOString(), zonedTime(addDaysToKey(weekKey, 7)).toISOString()), [weekKey]);

  const [editing, setEditing] = useState<TemplateForm | null>(null);
  const [roster, setRoster] = useState<ClassSession | null>(null);
  const [cancelling, setCancelling] = useState<ClassSession | null>(null);
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
                  {s.status === 'scheduled' && <button className="btn-sm btn-ghost text-danger" onClick={() => setCancelling(s)}>Cancel class</button>}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Section>

      {editing && <TemplateSheet value={editing} styles={styles} instructors={instructors} onClose={() => setEditing(null)} onSaved={() => { toast('Saved.'); void templates.reload(); }} />}
      {newSession && <SessionSheet styles={styles} instructors={instructors} onClose={() => setNewSession(false)} onSaved={() => { toast('Class added.'); void sessions.reload(); }} />}
      {roster && <RosterSheet session={roster} onClose={() => setRoster(null)} onChanged={() => void sessions.reload()} />}
      {cancelling && <CancelSessionSheet session={cancelling} onClose={() => setCancelling(null)} onDone={(n) => { toast(`Class cancelled. ${n} booking(s) refunded.`); void sessions.reload(); }} />}
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

type RosterRow = Booking & { profile: { full_name: string; email: string | null } | null };

function RosterSheet({ session, onClose, onChanged }: { session: ClassSession; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const rows = useAsync(async () =>
    unwrap(await supabase.from('bookings').select('*, profile:profiles(full_name,email)').eq('session_id', session.id).order('booked_at')) as RosterRow[], [session.id]);

  async function mark(b: RosterRow, status: 'attended' | 'no_show' | 'booked') {
    try {
      unwrap(await supabase.rpc('admin_set_attendance', { p_booking_id: b.id, p_status: status }));
      await rows.reload();
    } catch (e) {
      toast(e instanceof AppError ? e.message : (e as Error).message, 'error');
    }
  }
  async function cancel(b: RosterRow) {
    const reason = window.prompt('Reason for cancelling this booking (recorded in the audit log):');
    if (!reason?.trim()) return;
    const restore = window.confirm('Return the class to the customer’s membership?');
    try {
      unwrap(await supabase.rpc('admin_cancel_booking', { p_booking_id: b.id, p_reason: reason, p_restore: restore }));
      toast('Booking cancelled.');
      await rows.reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const started = new Date(session.starts_at).getTime() - 3_600_000 <= Date.now();
  return (
    <Sheet open onClose={onClose} title={`${session.title} — roster`}>
      <p className="text-sm text-muted">{fmt.dateTime(session.starts_at)} · {session.booked_count}/{session.capacity} booked</p>
      {!started && <div className="mt-3"><Notice tone="info">Attendance can be marked from 1 hour before class.</Notice></div>}
      <ul className="mt-4 divide-y divide-line">
        {rows.loading && <PageSpinner />}
        {rows.data?.length === 0 && <p className="py-4 text-sm text-muted">No bookings yet.</p>}
        {rows.data?.map((b) => (
          <li key={b.id} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{b.profile?.full_name || b.profile?.email}</p>
                <p className="text-xs text-muted">{b.status.replace('_', ' ')}{b.class_restored ? ' · class returned' : ''}</p>
              </div>
              {['booked', 'attended', 'no_show'].includes(b.status) && (
                <div className="flex flex-wrap justify-end gap-1">
                  {started && <button className={`btn-sm btn ${b.status === 'attended' ? 'bg-success text-white' : 'btn-ghost'}`} onClick={() => mark(b, 'attended')}>Attended</button>}
                  {started && <button className={`btn-sm btn ${b.status === 'no_show' ? 'bg-ink text-white' : 'btn-ghost'}`} onClick={() => mark(b, 'no_show')}>No-show</button>}
                  {b.status === 'booked' && <button className="btn-sm btn-ghost text-danger" onClick={() => cancel(b)}>Cancel</button>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

function CancelSessionSheet({ session, onClose, onDone }: { session: ClassSession; onClose: () => void; onDone: (n: number) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Cancel this class?">
      <p className="text-sm">{session.title} · {fmt.dateTime(session.starts_at)}</p>
      <div className="mt-3"><Notice tone="warn">All {session.booked_count} booking(s) will be cancelled and every customer gets their class back.</Notice></div>
      <div className="mt-3"><Field label="Reason (shown to customers)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Instructor unwell" /></Field></div>
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
