import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, unwrap } from '../api';
import { supabase } from '../lib/supabase';
import type { StaffSession } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { formatPrice } from '../domain/money';
import { addDaysToKey, fmt, formatKey, localDateKey, zonedTime } from '../domain/time';
import { StaffRoster } from '../components/StaffRoster';
import { ErrorNotice, PageSpinner } from '../components/ui';
import { events } from '../lib/events';
import { feedback, type FeedbackItem } from '../lib/feedback';
import { classPages } from '../lib/classPages';
import { holidays, range, type TimeOff } from '../lib/holidays';
import { FeedbackList, FeedbackSummary } from './Feedback';

interface Dashboard {
  payments_to_review: number; unfinished_checkouts: number; failed_monthly_payments: number; ticket_refunds: number;
  revenue_week_cents?: number; payments_week?: number; finance?: boolean; new_members_week: number; active_monthly: number; ending_monthly: number; bookings_today: number;
}

/** Home screen for admins and instructors: today's classes first, then what matters for their job. */
export default function StaffHome() {
  const { profile, isAdmin } = useAuth();
  const today = localDateKey(new Date());
  const days = isAdmin ? 1 : 7;
  const range = useMemo(() => ({ from: zonedTime(today).toISOString(), to: zonedTime(addDaysToKey(today, days)).toISOString() }), [today, days]);
  const sessions = useAsync(() => api.staffSessions(range.from, range.to), [range.from, days]);
  const [open, setOpen] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const first = profile?.full_name?.split(' ')[0] || 'there';

  const list = sessions.data ?? [];
  const now = Date.now();
  const upcoming = list.filter((s) => new Date(s.ends_at).getTime() > now && s.status === 'scheduled');
  const todays = list.filter((s) => localDateKey(new Date(s.starts_at)) === today);

  return (
    <div className="container-page max-w-4xl py-8">
      <p className="text-sm font-semibold text-muted">{formatKey(today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1 className="text-3xl font-black">Hi {first}</h1>

      {sessions.loading && !sessions.data ? <PageSpinner /> : sessions.error ? <div className="mt-6"><ErrorNotice error={sessions.error} onRetry={sessions.reload} /></div> : (
        isAdmin
          ? <AdminToday todays={todays} onOpen={setOpen} />
          : <InstructorToday upcoming={upcoming} today={today} onOpen={setOpen} onQr={(id) => { setQrFor(id); setOpen(id); }} />
      )}

      {open && <StaffRoster key={`${open}-${qrFor === open}`} sessionId={open} isAdmin={isAdmin} startWithQr={qrFor === open} onClose={() => { setOpen(null); setQrFor(null); }} onChanged={() => void sessions.reload()} />}
    </div>
  );
}

function ClassRow({ s, onOpen, showInstructor, label }: { s: StaffSession; onOpen: (id: string) => void; showInstructor?: boolean; label?: string }) {
  const pct = Math.min(100, Math.round((s.booked_count / s.capacity) * 100));
  const past = new Date(s.ends_at).getTime() < Date.now();
  return (
    <li>
      {label && <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">{label}</p>}
      <button onClick={() => onOpen(s.id)} className={`card w-full p-4 text-left transition hover:shadow-md ${s.status === 'cancelled' || past ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-extrabold">{fmt.time(s.starts_at)} · {s.title}</p>
            <p className="truncate text-sm text-muted">{showInstructor ? (s.instructor?.full_name ?? 'No instructor') : s.style?.name}{s.room ? ` · ${s.room}` : ''}</p>
          </div>
          <p className="shrink-0 text-right font-display text-xl font-black tabular-nums">{s.booked_count}<span className="text-sm font-semibold text-muted">/{s.capacity}</span></p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-ink' : pct >= 67 ? 'bg-accent-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {s.status === 'cancelled' && <span className="chip bg-red-50 text-danger">Cancelled</span>}
          {past && s.status !== 'cancelled' && <span className="chip bg-canvas text-muted">Finished</span>}
          {s.birthdays > 0 && <span className="chip bg-accent-100 text-ink">🎂 {s.birthdays} birthday{s.birthdays > 1 ? 's' : ''}</span>}
          {s.new_members > 0 && <span className="chip bg-brand-50 text-brand-700">{s.new_members} new</span>}
        </div>
      </button>
    </li>
  );
}

function AdminToday({ todays, onOpen }: { todays: StaffSession[]; onOpen: (id: string) => void }) {
  const d = useAsync(async () => unwrap(await supabase.rpc('admin_dashboard')) as Dashboard, []);
  const birthdays = useAsync(async () => {
    const rows = unwrap(await supabase.rpc('admin_instructor_birthdays')) as { instructor_id: string; next_birthday: string | null }[];
    const names = await api.instructors();
    const soon = addDaysToKey(localDateKey(new Date()), 7);
    return rows.filter((r) => r.next_birthday && r.next_birthday <= soon)
      .map((r) => ({ name: names.find((n) => n.id === r.instructor_id)?.full_name ?? 'Instructor', on: r.next_birthday! }));
  }, []);
  const requests = useAsync(async () => (await events.all()).filter((e) => e.status === 'pending').length, []);
  const v = d.data;
  const attention = v ? [
    { n: requests.data ?? 0, label: ['workshop request to approve', 'workshop requests to approve'], to: '/admin/events' },
    { n: v.failed_monthly_payments, label: ['monthly payment failed', 'monthly payments failed'], to: '/admin/customers' },
    { n: v.payments_to_review, label: ['payment to review', 'payments to review'], to: '/admin/customers' },
    { n: v.ticket_refunds, label: ['ticket needs a refund', 'tickets need a refund'], to: '/admin/audit' },
    { n: v.unfinished_checkouts, label: ['unfinished checkout (last 2 days)', 'unfinished checkouts (last 2 days)'], to: '/admin/customers' },
    { n: v.ending_monthly, label: ['monthly membership ending this week', 'monthly memberships ending this week'], to: '/admin/customers' },
  ].filter((a) => a.n > 0) : [];

  return (
    <div className="mt-6 space-y-8">
      <section aria-labelledby="today-h">
        <div className="flex items-end justify-between">
          <h2 id="today-h" className="text-xl font-black">Today’s classes</h2>
          <Link to="/teach" className="text-sm font-semibold text-brand-700">Next 2 weeks →</Link>
        </div>
        <p className="text-sm text-muted">Tap a class for the list, to edit it or to cancel it.{v ? ` ${v.bookings_today} booked today.` : ''}</p>
        <ul className="mt-3 space-y-2">
          {todays.length === 0 && <li className="card p-4 text-sm text-muted">No classes today.</li>}
          {todays.map((s) => <ClassRow key={s.id} s={s} onOpen={onOpen} showInstructor />)}
        </ul>
      </section>

      {attention.length > 0 && (
        <section aria-labelledby="att-h">
          <h2 id="att-h" className="text-xl font-black">Needs your attention</h2>
          <ul className="card mt-3 divide-y divide-line">
            {attention.map((a) => (
              <li key={a.label[1]}>
                <Link to={a.to} className="flex items-center justify-between gap-3 p-4 hover:bg-canvas">
                  <span><strong className="font-display text-lg">{a.n}</strong> {a.label[a.n === 1 ? 0 : 1]}</span><span aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {v && (
        <section aria-labelledby="week-h">
          <h2 id="week-h" className="text-xl font-black">This week</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {v.revenue_week_cents != null && <Stat label="Revenue" value={formatPrice(v.revenue_week_cents)} hint={`${v.payments_week} payments`} />}
            <Stat label="New members" value={String(v.new_members_week)} />
            <Stat label="Monthly members" value={String(v.active_monthly)} />
            <Stat label="Booked today" value={String(v.bookings_today)} />
          </div>
        </section>
      )}

      {(birthdays.data?.length ?? 0) > 0 && (
        <section aria-labelledby="bday-h">
          <h2 id="bday-h" className="text-xl font-black">🎂 Instructor birthdays this week</h2>
          <ul className="card mt-3 divide-y divide-line">
            {birthdays.data!.map((b) => <li key={b.name} className="p-4">{b.name} · <span className="text-muted">{formatKey(b.on, { weekday: 'long', day: 'numeric', month: 'long' })}</span></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="go-h">
        <h2 id="go-h" className="text-xl font-black">Manage</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Members', '/admin/customers'], ['Timetable', '/admin/timetable'], ['Bookings', '/admin/bookings'], ['Plans & prices', '/admin/plans'],
            ['Instructors', '/admin/instructors'], [v?.finance === false ? 'Overview' : 'Sales & reports', '/admin'], ['Settings', '/admin/settings'], ['Audit log', '/admin/audit']].map(([label, to]) => (
            <Link key={to} to={to} className="card p-4 text-center font-semibold hover:shadow-md">{label}</Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-black tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function InstructorToday({ upcoming, today, onOpen, onQr }: { upcoming: StaffSession[]; today: string; onOpen: (id: string) => void; onQr: (id: string) => void }) {
  const next = upcoming[0];
  const rest = upcoming.slice(1);
  const page = useAsync(() => classPages.mine().catch(() => null), []);
  const time = useAsync(() => holidays.mine().catch(() => [] as TimeOff[]), []);
  const fb = useAsync(() => feedback.staff(90).catch(() => [] as FeedbackItem[]), []);
  const items = fb.data ?? [];
  const avg = items.length ? (items.reduce((n, f) => n + f.rating, 0) / items.length).toFixed(1) : null;
  const nextOff = (time.data ?? []).find((t) => t.status !== 'declined' && t.ends_on >= today);
  const todo = [
    page.data?.todo && { icon: '✍️', text: 'Finish your bio and class page', to: '/teach/profile' },
    nextOff?.status === 'pending' && { icon: '⏳', text: `Time off ${range(nextOff.starts_on, nextOff.ends_on)}: waiting for approval`, to: '/teach/profile#holidays' },
  ].filter(Boolean) as { icon: string; text: string; to: string }[];

  return (
    <div className="mt-6 space-y-8">
      <NextClassCard s={next} today={today} onOpen={onOpen} onQr={onQr} />

      {todo.length > 0 && (
        <section aria-label="To do">
          <ul className="space-y-2">
            {todo.map((t) => (
              <li key={t.text}><Link to={t.to} className="flex items-center gap-3 rounded-2xl border-2 border-accent-500 bg-accent-50 p-4 font-semibold hover:shadow-md"><span className="text-2xl" aria-hidden>{t.icon}</span>{t.text}<span className="ml-auto text-brand-700">›</span></Link></li>
            ))}
          </ul>
        </section>
      )}
      {nextOff?.status === 'approved' && (
        <p className="rounded-2xl bg-success/10 p-4 text-sm font-semibold text-success">🌴 Your time off {range(nextOff.starts_on, nextOff.ends_on)} is approved. The studio is arranging cover.</p>
      )}

      <section aria-labelledby="quick-h">
        <h2 id="quick-h" className="text-xl font-black">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Tile to="/teach" icon="📅" title="My classes" hint="Next 2 weeks, who’s coming" tone="bg-brand-50" />
          <Tile to="/teach/profile#holidays" icon="🌴" title="Holidays" hint="Request time off" tone="bg-success/10" />
          <Tile to="/teach/events/new" icon="✨" title="Organise an event" hint="Themed class or workshop" tone="bg-accent-50" />
          <Tile to="#feedback" icon="⭐" title="My feedback" hint={avg ? `${avg}★ from ${items.length}` : 'What members say'} tone="bg-accent-100" />
          <Tile to="/teach/profile" icon="✍️" title="Bio & class page" hint="What new members read" tone="bg-white ring-1 ring-line" />
          <Tile to="/timetable" icon="💃" title="Take a class" hint="Free for instructors" tone="bg-white ring-1 ring-line" />
        </div>
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="week-i-h">
          <div className="flex items-end justify-between">
            <h2 id="week-i-h" className="text-xl font-black">Coming up this week</h2>
            <Link to="/teach" className="text-sm font-semibold text-brand-700">All classes →</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {rest.map((s) => <ClassRow key={s.id} s={s} onOpen={onOpen} label={dayLabel(s, today)} />)}
          </ul>
        </section>
      )}

      <InstructorFeedback />
      <OrganisePrompt />
    </div>
  );
}

function Tile({ to, icon, title, hint, tone }: { to: string; icon: string; title: string; hint: string; tone: string }) {
  const cls = `flex h-full flex-col gap-1 rounded-2xl p-4 transition hover:-translate-y-0.5 hover:shadow-md ${tone}`;
  const body = <><span className="text-3xl" aria-hidden>{icon}</span><span className="font-extrabold">{title}</span><span className="text-xs text-ink-soft">{hint}</span></>;
  return to.startsWith('#')
    ? <a href={to} className={cls}>{body}</a>
    : <Link to={to} className={cls}>{body}</Link>;
}

/** The next class, big: when it starts, who's coming, and one tap to the check-in QR or the class list. */
function NextClassCard({ s, today, onOpen, onQr }: { s?: StaffSession; today: string; onOpen: (id: string) => void; onQr: (id: string) => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  if (!s) {
    return (
      <section className="rounded-3xl bg-canvas p-6 text-center">
        <p className="text-4xl">🌙</p>
        <p className="mt-2 font-bold">No classes in the next 7 days</p>
        <p className="mt-1 text-sm text-muted">If you teach at Drop and expected to see classes here, ask the studio to link your account to your instructor profile.</p>
      </section>
    );
  }
  const start = new Date(s.starts_at).getTime(), end = new Date(s.ends_at).getTime(), now = Date.now();
  const live = now >= start && now < end;
  const qrOpen = now >= start - 3_600_000 && now < end;
  const mins = Math.round((start - now) / 60000);
  const when = live ? 'Happening now' : mins < 60 ? `Starts in ${mins} min` : mins < 24 * 60 ? `Starts in ${Math.floor(mins / 60)} h ${mins % 60} min` : `${dayLabel(s, today)} · ${fmt.time(s.starts_at)}`;
  const pct = Math.min(100, Math.round((s.booked_count / s.capacity) * 100));
  return (
    <section aria-labelledby="next-h" className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-600 to-brand-500 p-5 text-white shadow-lg sm:p-6">
      <p id="next-h" className="text-xs font-bold uppercase tracking-widest text-white/80">Your next class</p>
      <div className="mt-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-3xl font-black leading-tight">{s.title}</p>
          <p className="mt-1 font-semibold text-white/90">{when}{live || mins < 24 * 60 ? ` · ${fmt.time(s.starts_at)}–${fmt.time(s.ends_at)}` : ''}</p>
        </div>
        <div className="shrink-0 rounded-2xl bg-white/15 px-3 py-2 text-center">
          <p className="font-display text-3xl font-black tabular-nums leading-none">{s.booked_count}</p>
          <p className="text-[11px] font-semibold text-white/80">of {s.capacity} booked</p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20" aria-hidden="true"><div className="h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} /></div>
      {(s.birthdays > 0 || s.new_members > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-semibold">
          {s.new_members > 0 && <span className="rounded-full bg-white/15 px-3 py-1">✨ {s.new_members} first-timer{s.new_members > 1 ? 's' : ''}: say hi!</span>}
          {s.birthdays > 0 && <span className="rounded-full bg-accent-500 px-3 py-1 text-ink">🎂 {s.birthdays} birthday{s.birthdays > 1 ? 's' : ''}</span>}
        </div>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="btn whitespace-nowrap bg-white px-2 text-base font-black text-brand-700 hover:bg-white/90 disabled:opacity-60" disabled={!qrOpen} onClick={() => onQr(s.id)}>📲 Check-in QR</button>
        <button className="btn whitespace-nowrap border-2 border-white/60 px-2 text-base font-bold text-white hover:bg-white/10" onClick={() => onOpen(s.id)}>👥 Who’s coming</button>
      </div>
      {!qrOpen && <p className="mt-2 text-center text-xs text-white/75">The check-in QR opens 1 hour before class.</p>}
    </section>
  );
}

function dayLabel(s: StaffSession, today: string) {
  const key = localDateKey(new Date(s.starts_at));
  if (key === today) return 'Today';
  if (key === addDaysToKey(today, 1)) return 'Tomorrow';
  return formatKey(key, { weekday: 'long', day: 'numeric', month: 'short' });
}

function OrganisePrompt() {
  const themes = useAsync(() => events.themes(), []);
  const now = localDateKey(new Date());
  // From the last week of the month, look ahead to next month.
  const lastWeek = Number(now.slice(8)) >= 22;
  const month = themes.data?.[lastWeek ? 1 : 0] ?? themes.data?.[0];
  const list = (month?.themes ?? []).filter((t) => !t.on || t.on >= now).slice(0, 3);
  return (
    <section className="overflow-hidden rounded-2xl bg-ink p-5 text-white" aria-labelledby="org-h">
      <h2 id="org-h" className="font-display text-xl font-black">✨ Organise an event</h2>
      <p className="mt-1 text-sm text-white/75">Give one of your classes a theme, or run a paid workshop or gathering for your community.</p>
      {list.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {list.map((t) => (
            <li key={t.id}>
              <Link to={`/teach/events/new?theme=${t.id}`} className="font-semibold text-accent-400 hover:underline">
                {t.emoji} {t.name}{t.on ? ` · ${formatKey(t.on, { day: 'numeric', month: 'short' })}` : ''}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to="/teach/events/new" className="btn-accent btn-sm mt-4">Organise an event</Link>
    </section>
  );
}

function InstructorFeedback() {
  const [all, setAll] = useState(false);
  const fb = useAsync(() => feedback.staff(90).catch(() => [] as FeedbackItem[]), []);
  const items = fb.data ?? [];
  return (
    <section id="feedback" className="scroll-mt-20" aria-labelledby="fb-h">
      <h2 id="fb-h" className="text-xl font-black">Your feedback</h2>
      <p className="mt-1 text-xs text-muted">Members are asked after their first class in a style, every 6th class and after events. Names are kept private.</p>
      <div className="mt-2"><FeedbackSummary items={items} /></div>
      {items.length > 0 && <div className="mt-3"><FeedbackList items={all ? items : items.slice(0, 3)} /></div>}
      {items.length > 3 && <button className="mt-2 text-sm font-semibold text-brand-700" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>}
    </section>
  );
}
