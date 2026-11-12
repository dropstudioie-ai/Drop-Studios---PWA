import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { StaffSession } from '../api/types';
import { useAuth } from '../auth/AuthProvider';
import { useAsync } from '../lib/useAsync';
import { euroToCents, events, type StudioEvent, type Theme } from '../lib/events';
import { formatPrice } from '../domain/money';
import { addDaysToKey, fmt, formatKey, localDateKey, zonedTime } from '../domain/time';
import { EmptyState, ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../components/ui';

const monthLabel = (m: string) => formatKey(m, { month: 'long', year: 'numeric' });
const themeDay = (t: Theme) => (t.on ? formatKey(t.on, { weekday: 'short', day: 'numeric', month: 'short' }) : 'All month');

/** Instructor: coming-up themes, their events, and the way in to organise one. */
export default function Events() {
  const themes = useAsync(() => events.themes(), []);
  const mine = useAsync(() => events.mine(), []);
  const [editing, setEditing] = useState<StudioEvent | null>(null);

  return (
    <div className="container-page max-w-4xl py-8">
      <p className="text-sm font-semibold text-muted">For instructors</p>
      <h1 className="text-3xl font-black">Organise an event</h1>
      <p className="mt-2 max-w-2xl text-ink-soft">
        Make one of your classes special with a theme, or run a workshop or gathering. It’s a great way to bring your community
        together, and workshops are paid, so you can earn extra.
      </p>
      <Link to="/teach/events/new" className="btn-accent mt-5 text-lg">✨ Organise an event</Link>

      <section className="mt-10" aria-labelledby="themes-h">
        <h2 id="themes-h" className="text-xl font-black">Important dates coming up</h2>
        <p className="text-sm text-muted">Ideas to inspire you. You can also choose your own theme.</p>
        {themes.loading && !themes.data ? <PageSpinner /> : themes.error ? <ErrorNotice error={themes.error} onRetry={themes.reload} /> : (
          <div className="mt-3 space-y-5">
            {themes.data!.map((m) => (
              <div key={m.month}>
                <p className="text-xs font-bold uppercase tracking-wide text-muted">{monthLabel(m.month)}</p>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {m.themes.length === 0 && <li className="text-sm text-muted">No dates this month. Pick your own theme!</li>}
                  {m.themes.map((t) => (
                    <li key={t.id}>
                      <Link to={`/teach/events/new?theme=${t.id}`} className="card block h-full p-4 hover:shadow-md">
                        <p className="font-display text-lg font-extrabold">{t.emoji} {t.name}</p>
                        <p className="text-xs font-semibold text-accent-600">{themeDay(t)}</p>
                        {t.ideas && <p className="mt-1 text-sm text-ink-soft">{t.ideas}</p>}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10" aria-labelledby="mine-h">
        <h2 id="mine-h" className="text-xl font-black">Your events</h2>
        {mine.loading && !mine.data ? <PageSpinner /> : mine.error ? <ErrorNotice error={mine.error} onRetry={mine.reload} /> : mine.data!.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nothing yet. Your special classes and workshops will show here.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {mine.data!.map((e) => <EventCard key={e.id} e={e} onEdit={() => setEditing(e)} />)}
          </ul>
        )}
      </section>

      {editing && <EditEventSheet e={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); void mine.reload(); }} />}
    </div>
  );
}

const STATUS: Record<StudioEvent['status'], [string, string]> = {
  pending: ['Waiting for approval', 'bg-accent-100 text-ink'],
  published: ['Live', 'bg-success text-white'],
  declined: ['Not approved', 'bg-red-50 text-danger'],
  cancelled: ['Cancelled', 'bg-canvas text-muted'],
};

export function EventCard({ e, onEdit, admin }: { e: StudioEvent; onEdit?: () => void; admin?: boolean }) {
  const start = e.session?.starts_at ?? e.starts_at;
  const past = start ? new Date(start) < new Date() : false;
  const [label, cls] = STATUS[e.status];
  return (
    <li className={`card p-4 ${past || e.status === 'cancelled' || e.status === 'declined' ? 'opacity-70' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            {e.kind === 'workshop' ? 'Workshop / gathering' : 'Special class'}{admin && e.instructor ? ` · ${e.instructor}` : ''}
          </p>
          <p className="font-display text-lg font-extrabold">{e.theme?.emoji ?? '✨'} {e.title}</p>
          {start && <p className="text-sm text-ink-soft">{fmt.dateTime(start)}{e.session && e.kind === 'special_class' ? ` · ${e.session.title}` : ''}</p>}
        </div>
        <span className={`chip ${past && e.status === 'published' ? 'bg-canvas text-muted' : cls}`}>{past && e.status === 'published' ? 'Done' : label}</span>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {e.dress_code && <div><dt className="inline text-muted">Wear: </dt><dd className="inline">{e.dress_code}</dd></div>}
        {e.decorations && <div><dt className="inline text-muted">Decorations (studio): </dt><dd className="inline">{e.decorations}</dd></div>}
        {e.extras && <div><dt className="inline text-muted">Snacks &amp; ideas: </dt><dd className="inline">{e.extras}</dd></div>}
        {e.kind === 'workshop' && e.price_cents != null && (
          <div><dt className="inline text-muted">Price: </dt><dd className="inline">{formatPrice(e.price_cents)}{e.member_price_cents != null ? ` · members ${formatPrice(e.member_price_cents)}` : ''}</dd></div>
        )}
        {e.session && <div><dt className="inline text-muted">Booked: </dt><dd className="inline">{e.session.booked_count}/{e.session.capacity}</dd></div>}
        {e.kind === 'workshop' && e.status === 'published' && (
          <div><dt className="inline text-muted">Tickets sold: </dt><dd className="inline">{e.tickets_sold} · {formatPrice(e.ticket_revenue_cents)}</dd></div>
        )}
        {e.kind === 'workshop' && e.status !== 'declined' && e.status !== 'cancelled' && (
          <div className="sm:col-span-2">
            <dt className="inline text-muted">Split {e.instructor_share_pct}/{100 - e.instructor_share_pct} after card fees: </dt>
            <dd className="inline">
              {admin ? e.instructor ?? 'Instructor' : 'You'} <strong>{formatPrice(e.instructor_earnings_cents, 'EUR', { forceDecimals: true })}</strong>
              {' '}· Studio {formatPrice(e.studio_earnings_cents, 'EUR', { forceDecimals: true })}
              {e.fees_cents > 0 && <span className="text-muted"> (fees {formatPrice(e.fees_cents, 'EUR', { forceDecimals: true })})</span>}
              {e.fees_pending > 0 && <span className="block text-xs text-muted">Square hasn’t reported the fee on {e.fees_pending} ticket{e.fees_pending === 1 ? '' : 's'} yet, so this may go down slightly.</span>}
            </dd>
          </div>
        )}
        {e.status !== 'pending' && e.announced_to > 0 && <div><dt className="inline text-muted">Told: </dt><dd className="inline">{e.announced_to} people</dd></div>}
      </dl>
      {e.admin_note && <p className="mt-2 text-sm"><span className="text-muted">Note from the studio:</span> {e.admin_note}</p>}
      {onEdit && !past && (e.status === 'pending' || e.status === 'published') && (
        <button className="btn-outline btn-sm mt-3" onClick={onEdit}>Edit · reschedule · cancel</button>
      )}
    </li>
  );
}

export function EditEventSheet({ e, onClose, onDone }: { e: StudioEvent; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState<'details' | 'move' | 'cancel'>('details');
  const [title, setTitle] = useState(e.title);
  const [d, setD] = useState({ description: e.description ?? '', dress: e.dress_code ?? '', decorations: e.decorations ?? '', extras: e.extras ?? '' });
  const [money, setMoney] = useState({
    capacity: String(e.session?.capacity ?? e.capacity ?? 20),
    price: e.price_cents != null ? String(e.price_cents / 100) : '',
    member: e.member_price_cents != null ? String(e.member_price_cents / 100) : '',
  });
  const start = e.session?.starts_at ?? e.starts_at ?? new Date().toISOString();
  const end = e.session?.ends_at ?? e.ends_at ?? start;
  const [when, setWhen] = useState({ date: localDateKey(new Date(start)), start: fmt.time(start), end: fmt.time(end), sessionId: '', note: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workshop = e.kind === 'workshop';
  const paidWorkshop = workshop && e.status === 'published';
  const sold = e.tickets_sold > 0;

  // Other classes by the same instructor, for moving a theme.
  const classes = useAsync(async () => {
    if (workshop || tab !== 'move') return [];
    const today = localDateKey(new Date());
    const [list, taken] = await Promise.all([
      api.staffSessions(new Date().toISOString(), zonedTime(addDaysToKey(today, 42)).toISOString()),
      isAdmin ? events.all() : events.mine(),
    ]);
    const used = new Set(taken.filter((x) => x.status === 'pending' || x.status === 'published').map((x) => x.session_id));
    return list.filter((s) => s.instructor_id === e.instructor_id && s.status === 'scheduled' && !s.is_special && !used.has(s.id) && new Date(s.starts_at) > new Date());
  }, [tab, workshop, isAdmin]);
  const busySlots = useAsync(() => (workshop && tab === 'move' && when.date ? events.busy(when.date) : Promise.resolve([])), [workshop, tab, when.date]);

  async function go(fn: () => Promise<unknown>, msg: (r: unknown) => string) {
    setBusy(true);
    setError(null);
    try { const r = await fn(); toast(msg(r)); onDone(); } catch (x) { setError((x as Error).message); setBusy(false); }
  }
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const notified = (r: unknown) => (r as { notified?: number })?.notified ?? 0;

  function saveDetails() {
    let price: number | null = null, member: number | null = null;
    if (workshop) {
      price = euroToCents(money.price);
      member = euroToCents(money.member);
      if (price == null || Number.isNaN(price)) { setError('Enter the ticket price, e.g. 25.'); return; }
      if (member != null && Number.isNaN(member)) { setError('Enter the member price like 20 or 20.50, or leave it empty.'); return; }
    }
    void go(() => events.edit(e.id, { title, ...d, capacity: workshop ? Number(money.capacity) || 0 : null, priceCents: price, memberPriceCents: member }), () => 'Saved.');
  }

  function move() {
    if (workshop) {
      void go(() => events.reschedule(e.id, { startsAt: zonedTime(when.date, toMin(when.start)).toISOString(), endsAt: zonedTime(when.date, toMin(when.end)).toISOString(), note: when.note }),
        (r) => e.status === 'published' ? `Moved. ${notified(r)} people were told the new date.` : 'Moved. The studio will see the new time.');
    } else {
      if (!when.sessionId) { setError('Choose the new class.'); return; }
      void go(() => events.reschedule(e.id, { sessionId: when.sessionId, note: when.note }), (r) => `Theme moved. ${notified(r)} people were told.`);
    }
  }

  const tabs: [typeof tab, string][] = [['details', 'Details'], ['move', 'Reschedule'], ['cancel', 'Cancel']];
  return (
    <Sheet open onClose={onClose} title={e.title}>
      <div className="-mt-2 mb-4 flex gap-1 rounded-xl bg-canvas p-1" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setError(null); }}
            className={`flex-1 rounded-lg px-2 py-2 text-sm font-bold ${tab === k ? 'bg-white shadow-sm' : 'text-muted'}`}>{label}</button>
        ))}
      </div>

      {tab === 'details' && (
        <div className="space-y-3">
          <Field label="Name"><input className="input" maxLength={80} value={title} onChange={(x) => setTitle(x.target.value)} /></Field>
          {workshop && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Places"><input className="input" inputMode="numeric" value={money.capacity} onChange={(x) => setMoney({ ...money, capacity: x.target.value.replace(/\D/g, '') })} /></Field>
                <Field label="Price (€)"><input className="input" inputMode="decimal" disabled={sold} value={money.price} onChange={(x) => setMoney({ ...money, price: x.target.value })} /></Field>
                <Field label="Members (€)"><input className="input" inputMode="decimal" disabled={sold} value={money.member} onChange={(x) => setMoney({ ...money, member: x.target.value })} /></Field>
              </div>
              {sold && <p className="text-xs text-muted">Tickets have been bought, so the prices are fixed.</p>}
            </>
          )}
          <DetailFields d={d} setD={setD} />
          <p className="text-xs text-muted">Changes show in the app and in the reminder the day before. Nobody gets a new message now.</p>
          {error && <ErrorNotice error={error} />}
          <button className="btn-primary w-full" disabled={busy} onClick={saveDetails}>{busy && <Spinner />}Save</button>
        </div>
      )}

      {tab === 'move' && (
        <div className="space-y-3">
          {workshop ? (
            <>
              <Field label="New date"><input className="input" type="date" min={addDaysToKey(localDateKey(new Date()), 1)} value={when.date} onChange={(x) => setWhen({ ...when, date: x.target.value })} /></Field>
              <div className="rounded-xl bg-canvas p-3 text-sm">
                <p className="font-semibold">Studio already busy that day</p>
                {busySlots.loading ? <Spinner /> : (busySlots.data ?? []).filter((b) => b.title !== e.title).length === 0
                  ? <p className="text-muted">Free all day.</p>
                  : <ul className="mt-1 space-y-0.5">{busySlots.data!.filter((b) => b.title !== e.title).map((b, i) => (
                    <li key={i}>{fmt.time(b.starts_at)}–{fmt.time(b.ends_at)} · {b.title}{b.pending ? ' (workshop request)' : ''}</li>
                  ))}</ul>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Starts"><input className="input" type="time" value={when.start} onChange={(x) => setWhen({ ...when, start: x.target.value })} /></Field>
                <Field label="Ends"><input className="input" type="time" value={when.end} onChange={(x) => setWhen({ ...when, end: x.target.value })} /></Field>
              </div>
            </>
          ) : classes.loading ? <PageSpinner /> : classes.error ? <ErrorNotice error={classes.error} /> : (classes.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">There’s no other class in the next 6 weeks to move the theme to.</p>
          ) : (
            <ul className="space-y-2">
              {classes.data!.map((s) => (
                <li key={s.id}>
                  <label className={`card flex cursor-pointer items-center gap-3 p-3 ${when.sessionId === s.id ? 'ring-2 ring-brand-600' : ''}`}>
                    <input type="radio" name="move" checked={when.sessionId === s.id} onChange={() => setWhen({ ...when, sessionId: s.id })} />
                    <span className="font-bold">{fmt.dayMonth(s.starts_at)} · {fmt.time(s.starts_at)} · {s.title}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <Field label="Message to members (optional)"><input className="input" value={when.note} onChange={(x) => setWhen({ ...when, note: x.target.value })} placeholder="e.g. Sorry for the change!" /></Field>
          {e.status === 'published' && (
            <Notice tone="info">
              {workshop
                ? 'Ticket holders are told the new date (and can ask for a refund if they can’t make it), and so is everyone who was told about it.'
                : 'People booked on the old class are told it’s now a normal class, people booked on the new class get the details, and everyone who was told about it gets the new date.'}
            </Notice>
          )}
          {error && <ErrorNotice error={error} />}
          <button className="btn-primary w-full" disabled={busy} onClick={move}>{busy && <Spinner />}Reschedule</button>
        </div>
      )}

      {tab === 'cancel' && (
        <div className="space-y-3">
          <Notice tone="warn">
            {paidWorkshop
              ? `The workshop is cancelled and taken off the timetable. Everyone booked is told${sold ? `, and their ${e.tickets_sold} ticket${e.tickets_sold === 1 ? ' is' : 's are'} flagged for a refund` : ''}.`
              : workshop ? 'The request is withdrawn.' : 'The theme is removed. The class still runs as normal and everyone booked is told.'}
          </Notice>
          <Field label={paidWorkshop ? 'Reason (shown to members)' : 'Reason (optional)'}>
            <input className="input" value={reason} onChange={(x) => setReason(x.target.value)} placeholder="e.g. Instructor unwell" />
          </Field>
          {error && <ErrorNotice error={error} />}
          <button className="btn-danger w-full" disabled={busy || (paidWorkshop && !reason.trim())}
            onClick={() => void go(() => events.cancel(e.id, reason), (r) => `${paidWorkshop ? 'Workshop cancelled' : workshop ? 'Request withdrawn' : 'Theme removed'}.${notified(r) ? ` ${notified(r)} people were told.` : ''}`)}>
            {busy && <Spinner />}{paidWorkshop ? 'Cancel workshop' : workshop ? 'Withdraw request' : 'Remove theme'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

type Details = { description: string; dress: string; decorations: string; extras: string };

function DetailFields({ d, setD }: { d: Details; setD: (d: Details) => void }) {
  return (
    <>
      <Field label="Message to members" hint="What makes it special? This is what people read when they’re told about it.">
        <textarea className="input min-h-24" maxLength={1000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
          placeholder="e.g. Our darkest, most energetic class of the year. Bring a friend!" />
      </Field>
      <Field label="What members could wear (optional)" hint="Members are told it’s encouraged, never required, so everyone feels welcome.">
        <input className="input" maxLength={200} value={d.dress} onChange={(e) => setD({ ...d, dress: e.target.value })} placeholder="e.g. All black" />
      </Field>
      <Field label="Decorations the studio should provide (optional)" hint="Only the studio sees this.">
        <textarea className="input min-h-20" maxLength={1000} value={d.decorations} onChange={(e) => setD({ ...d, decorations: e.target.value })} placeholder="e.g. UV lights, black balloons" />
      </Field>
      <Field label="Snacks and other ideas (optional)" hint="Only the studio sees this.">
        <textarea className="input min-h-20" maxLength={1000} value={d.extras} onChange={(e) => setD({ ...d, extras: e.target.value })} placeholder="e.g. Licorice and sparkling water after class, a group photo" />
      </Field>
    </>
  );
}

/** Step by step: type → theme → when → details → send. */
export function OrganiseEvent() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const today = localDateKey(new Date());

  const themes = useAsync(() => events.themes(), []);
  const styles = useAsync(() => api.styles(), []);
  const settings = useAsync(() => api.settings(), []);
  const share = settings.data?.workshop_instructor_share_pct ?? 70;
  const instructors = useAsync(() => (isAdmin ? api.instructors() : Promise.resolve([])), [isAdmin]);
  const classes = useAsync(async () => {
    const [list, mine] = await Promise.all([
      api.staffSessions(new Date().toISOString(), zonedTime(addDaysToKey(today, 42)).toISOString()),
      isAdmin ? events.all() : events.mine(),
    ]);
    const taken = new Set(mine.filter((e) => e.status === 'pending' || e.status === 'published').map((e) => e.session_id));
    return list.filter((s) => s.status === 'scheduled' && !s.is_special && !taken.has(s.id) && new Date(s.starts_at) > new Date());
  }, [today, isAdmin]);

  const allThemes = useMemo(() => themes.data?.flatMap((m) => m.themes) ?? [], [themes.data]);
  const [kind, setKind] = useState<'special_class' | 'workshop' | null>(null);
  const [themeId, setThemeId] = useState<string | null>(params.get('theme'));
  const theme = allThemes.find((t) => t.id === themeId) ?? null;
  const [title, setTitle] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [w, setW] = useState({ date: addDaysToKey(today, 14), start: '14:00', end: '16:00', styleId: '', capacity: '20', price: '', memberPrice: '', instructorId: '' });
  const [d, setD] = useState<Details>({ description: '', dress: '', decorations: '', extras: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenClass = classes.data?.find((s) => s.id === sessionId);
  const audienceFor = kind === 'workshop' ? (isAdmin ? w.instructorId : '') : (isAdmin ? chosenClass?.instructor_id ?? '' : '');
  const audience = useAsync(async () => (isAdmin && !audienceFor ? null : events.audience(audienceFor || undefined)), [audienceFor, isAdmin]);
  const busySlots = useAsync(() => (kind === 'workshop' && w.date ? events.busy(w.date) : Promise.resolve([])), [kind, w.date]);

  // Suggest a title from the theme (and the class).
  useEffect(() => {
    if (!theme) return;
    setTitle((t) => t || theme.name);
    setD((x) => (x.description ? x : { ...x, description: theme.ideas ?? '' }));
  }, [theme]);

  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

  async function submit() {
    setError(null);
    if (!title.trim()) { setError('Give it a name.'); return; }
    setBusy(true);
    try {
      if (kind === 'special_class') {
        if (!sessionId) throw new Error('Choose which class.');
        const r = await events.special({ sessionId, title: title.trim(), ...d, themeId });
        toast(`Done! ${r.announced} people were told, and ${r.booked_told} already booked got the details.`);
      } else {
        const price = euroToCents(w.price);
        const member = euroToCents(w.memberPrice);
        if (price == null || Number.isNaN(price)) throw new Error('Enter the ticket price, e.g. 25.');
        if (member != null && Number.isNaN(member)) throw new Error('Enter the member price like 20 or 20.50, or leave it empty.');
        if (!w.styleId) throw new Error('Choose a dance style.');
        if (isAdmin && !w.instructorId) throw new Error('Choose the instructor.');
        await events.workshop({
          title: title.trim(), styleId: w.styleId, capacity: Number(w.capacity) || 20, priceCents: price, memberPriceCents: member,
          startsAt: zonedTime(w.date, toMin(w.start)).toISOString(), endsAt: zonedTime(w.date, toMin(w.end)).toISOString(),
          ...d, themeId, instructorId: isAdmin ? w.instructorId : null,
        });
        toast('Sent to the studio for approval. You’ll get a notification when it’s decided.');
      }
      navigate('/teach/events');
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (themes.loading && !themes.data) return <PageSpinner />;

  return (
    <div className="container-page max-w-2xl py-8">
      <Link to="/teach/events" className="text-sm font-semibold text-brand-700">← Events</Link>
      <h1 className="mt-2 text-3xl font-black">Organise an event</h1>

      <Step n={1} title="What would you like to organise?">
        <div className="grid gap-3 sm:grid-cols-2">
          <Choice active={kind === 'special_class'} onClick={() => setKind('special_class')} title="✨ Special class"
            text="One of your regular classes, same day and time, with a theme. Members book it with their membership as usual. It goes live straight away." />
          <Choice active={kind === 'workshop'} onClick={() => setKind('workshop')} title="🎟️ Workshop / gathering"
            text="A new event outside the timetable, when the studio is free. Set a ticket price for members and non-members. The studio approves it first." />
        </div>
      </Step>

      {kind && (
        <Step n={2} title="Theme">
          <div className="flex flex-wrap gap-2">
            {allThemes.map((t) => (
              <button key={t.id} type="button" onClick={() => { setThemeId(t.id === themeId ? null : t.id); setTitle(t.id === themeId ? title : t.name); }}
                className={`chip border px-3 py-1.5 text-sm ${t.id === themeId ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink'}`}>
                {t.emoji} {t.name} <span className="text-muted">· {themeDay(t)}</span>
              </button>
            ))}
            <button type="button" onClick={() => setThemeId(null)}
              className={`chip border px-3 py-1.5 text-sm ${!themeId ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white text-ink'}`}>My own theme</button>
          </div>
          {theme?.ideas && <p className="mt-2 text-sm text-ink-soft">💡 {theme.ideas}</p>}
          <div className="mt-3">
            <Field label="Name" hint="Members see this on the timetable.">
              <input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. All Black FitDance" />
            </Field>
          </div>
        </Step>
      )}

      {kind === 'special_class' && (
        <Step n={3} title="Which class?">
          {classes.loading && !classes.data ? <PageSpinner /> : classes.error ? <ErrorNotice error={classes.error} /> : classes.data!.length === 0 ? (
            <EmptyState title="No classes to theme">You have no classes in the next 6 weeks without a theme.</EmptyState>
          ) : (
            <ul className="space-y-2">
              {classes.data!.map((s: StaffSession) => (
                <li key={s.id}>
                  <label className={`card flex cursor-pointer items-center gap-3 p-3 ${sessionId === s.id ? 'ring-2 ring-brand-600' : ''}`}>
                    <input type="radio" name="cls" checked={sessionId === s.id} onChange={() => setSessionId(s.id)} />
                    <span className="min-w-0">
                      <span className="block font-bold">{fmt.dayMonth(s.starts_at)} · {fmt.time(s.starts_at)} · {s.title}</span>
                      <span className="block text-xs text-muted">{isAdmin && s.instructor ? `${s.instructor.full_name} · ` : ''}{s.booked_count} booked so far</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Step>
      )}

      {kind === 'workshop' && (
        <Step n={3} title="When and how much?">
          <div className="space-y-3">
            {isAdmin && (
              <Field label="Instructor">
                <select className="input" value={w.instructorId} onChange={(e) => setW({ ...w, instructorId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(instructors.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Date" hint="At least 3 days from now.">
              <input className="input" type="date" min={addDaysToKey(today, 3)} value={w.date} onChange={(e) => setW({ ...w, date: e.target.value })} />
            </Field>
            <div className="rounded-xl bg-canvas p-3 text-sm">
              <p className="font-semibold">Studio already busy that day</p>
              {busySlots.loading ? <Spinner /> : (busySlots.data ?? []).length === 0
                ? <p className="text-muted">Free all day.</p>
                : <ul className="mt-1 space-y-0.5">{busySlots.data!.map((b, i) => (
                  <li key={i}>{fmt.time(b.starts_at)}–{fmt.time(b.ends_at)} · {b.title}{b.pending ? ' (workshop request)' : ''}</li>
                ))}</ul>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Starts"><input className="input" type="time" value={w.start} onChange={(e) => setW({ ...w, start: e.target.value })} /></Field>
              <Field label="Ends"><input className="input" type="time" value={w.end} onChange={(e) => setW({ ...w, end: e.target.value })} /></Field>
            </div>
            <Field label="Dance style">
              <select className="input" value={w.styleId} onChange={(e) => setW({ ...w, styleId: e.target.value })}>
                <option value="">Choose…</option>
                {(styles.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Places"><input className="input" inputMode="numeric" value={w.capacity} onChange={(e) => setW({ ...w, capacity: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Price (€)"><input className="input" inputMode="decimal" value={w.price} onChange={(e) => setW({ ...w, price: e.target.value })} placeholder="25" /></Field>
              <Field label="Members (€)"><input className="input" inputMode="decimal" value={w.memberPrice} onChange={(e) => setW({ ...w, memberPrice: e.target.value })} placeholder="20" /></Field>
            </div>
            <p className="text-xs text-muted">Anyone can buy a ticket in the app. Members with an active membership pay the member price (leave it empty for one price for everyone).</p>
            <WorkshopEarnings share={share} price={euroToCents(w.price)} capacity={Number(w.capacity) || 0} />
          </div>
        </Step>
      )}

      {kind && (
        <Step n={4} title="The details">
          <div className="space-y-3"><DetailFields d={d} setD={setD} /></div>
        </Step>
      )}

      {kind && (
        <div className="mt-8 space-y-3">
          <Notice tone="info">
            {kind === 'special_class'
              ? <>When you send it, {audience.data != null ? <strong>{audience.data} {audience.data === 1 ? 'person' : 'people'}</strong> : 'everyone'} who booked {isAdmin ? 'this instructor’s' : 'your'} classes in the last 3 months {audience.data === 1 ? 'is' : 'are'} told, and everyone booked on the class gets the details. People who book later get them too, plus a reminder the day before.</>
              : <>The studio checks it first. Once approved it goes on the timetable and {audience.data != null ? <strong>{audience.data} {audience.data === 1 ? 'person' : 'people'}</strong> : 'everyone'} who booked {isAdmin ? 'this instructor’s' : 'your'} classes in the last 3 months {audience.data === 1 ? 'is' : 'are'} told.</>}
          </Notice>
          {error && <ErrorNotice error={error} />}
          <button className="btn-accent w-full text-lg" disabled={busy} onClick={() => void submit()}>
            {busy && <Spinner />}{kind === 'special_class' ? 'Publish and tell members' : 'Send to the studio'}
          </button>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 text-lg font-black">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-sm text-white">{n}</span>{title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Choice({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`card h-full p-4 text-left transition ${active ? 'ring-2 ring-brand-600' : 'hover:shadow-md'}`}>
      <p className="font-display text-lg font-extrabold">{title}</p>
      <p className="mt-1 text-sm text-ink-soft">{text}</p>
    </button>
  );
}

function WorkshopEarnings({ share, price, capacity }: { share: number; price: number | null; capacity: number }) {
  const full = price != null && !Number.isNaN(price) && capacity > 0 ? price * capacity : null;
  return (
    <div className="rounded-xl border-2 border-success/40 bg-green-50/60 p-3 text-sm">
      <p className="font-bold">💶 You keep {share}% of ticket sales after Square’s card fee. The studio keeps {100 - share}% for the space and promotion.</p>
      {full != null && (
        <p className="mt-1 text-ink-soft">
          Sold out at full price: {formatPrice(full)} in tickets, so about <strong>{formatPrice(Math.round((full * share) / 100))}</strong> for you
          {' '}before card fees (less if members buy at the member price).
        </p>
      )}
    </div>
  );
}
