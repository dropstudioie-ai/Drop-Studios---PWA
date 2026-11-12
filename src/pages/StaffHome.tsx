import { useMemo, useState } from 'react';
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

interface Dashboard {
  payments_to_review: number; unfinished_checkouts: number; failed_monthly_payments: number; ticket_refunds: number;
  revenue_week_cents: number; payments_week: number; new_members_week: number; active_monthly: number; ending_monthly: number; bookings_today: number;
}

/** Home screen for admins and instructors: today's classes first, then what matters for their job. */
export default function StaffHome() {
  const { profile, isAdmin } = useAuth();
  const today = localDateKey(new Date());
  const days = isAdmin ? 1 : 7;
  const range = useMemo(() => ({ from: zonedTime(today).toISOString(), to: zonedTime(addDaysToKey(today, days)).toISOString() }), [today, days]);
  const sessions = useAsync(() => api.staffSessions(range.from, range.to), [range.from, days]);
  const [open, setOpen] = useState<string | null>(null);
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
          : <InstructorToday upcoming={upcoming} today={today} onOpen={setOpen} />
      )}

      {open && <StaffRoster sessionId={open} isAdmin={isAdmin} onClose={() => setOpen(null)} onChanged={() => void sessions.reload()} />}
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
            <Stat label="Revenue" value={formatPrice(v.revenue_week_cents)} hint={`${v.payments_week} payments`} />
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
            ['Instructors', '/admin/instructors'], ['Sales & reports', '/admin'], ['Settings', '/admin/settings'], ['Audit log', '/admin/audit']].map(([label, to]) => (
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

function InstructorToday({ upcoming, today, onOpen }: { upcoming: StaffSession[]; today: string; onOpen: (id: string) => void }) {
  const next = upcoming[0];
  const rest = upcoming.slice(1);
  return (
    <div className="mt-6 space-y-8">
      <section aria-labelledby="next-h">
        <h2 id="next-h" className="text-xl font-black">Your next class</h2>
        {next ? (
          <ul className="mt-3 space-y-2">
            <ClassRow s={next} onOpen={onOpen} label={dayLabel(next, today)} />
          </ul>
        ) : (
          <p className="card mt-3 p-4 text-sm text-muted">No classes in the next 7 days. If you teach at Drop, ask the studio to link your account to your instructor profile.</p>
        )}
        {next && <p className="mt-2 text-sm text-muted">Tap it for who’s coming: photos, who’s new and birthdays. You can add a member at the door and mark attendance.</p>}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="week-i-h">
          <div className="flex items-end justify-between">
            <h2 id="week-i-h" className="text-xl font-black">This week</h2>
            <Link to="/teach" className="text-sm font-semibold text-brand-700">Next 2 weeks →</Link>
          </div>
          <ul className="mt-3 space-y-2">
            {rest.map((s) => <ClassRow key={s.id} s={s} onOpen={onOpen} label={dayLabel(s, today)} />)}
          </ul>
        </section>
      )}

      <OrganisePrompt />

      <section className="card p-5" aria-labelledby="free-h">
        <h2 id="free-h" className="font-extrabold">Want to take a class?</h2>
        <p className="mt-1 text-sm text-ink-soft">As an instructor you can book any class for free from the timetable.</p>
        <Link to="/timetable" className="btn-outline btn-sm mt-3">Open the timetable</Link>
      </section>
    </div>
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
