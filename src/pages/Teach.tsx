import { useMemo, useState } from 'react';
import { api } from '../api';
import type { StaffSession } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { addDaysToKey, fmt, formatKey, localDateKey, zonedTime } from '../domain/time';
import { StaffRoster } from '../components/StaffRoster';
import { BirthdayCard } from '../components/BirthdayCard';
import { EmptyState, ErrorNotice, PageSpinner } from '../components/ui';

/** Instructor view: the classes I teach in the next two weeks, with numbers and highlights. */
export default function Teach() {
  const { profile, isAdmin, refreshProfile } = useAuth();
  if (profile && !isAdmin && !profile.date_of_birth) {
    return (
      <div className="container-page max-w-3xl py-8">
        <h1 className="text-3xl font-black">My classes</h1>
        <p className="mt-1 mb-6 text-ink-soft">One quick thing before you see your classes.</p>
        <BirthdayCard forTeacher onSaved={refreshProfile} />
      </div>
    );
  }
  return <TeachClasses />;
}

function TeachClasses() {
  const { profile, isAdmin } = useAuth();
  const today = localDateKey(new Date());
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [weeksBack, setWeeksBack] = useState(0);
  // Past: Monday–Sunday of the chosen week, only classes that have started, newest first.
  const monday = addDaysToKey(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) - weeksBack * 7);
  const range = useMemo(() => tab === 'upcoming'
    ? { from: zonedTime(today).toISOString(), to: zonedTime(addDaysToKey(today, 14)).toISOString() }
    : { from: zonedTime(monday).toISOString(), to: (weeksBack === 0 ? new Date() : zonedTime(addDaysToKey(monday, 7))).toISOString() }, [tab, today, monday, weeksBack]);
  const sessions = useAsync(() => api.staffSessions(range.from, range.to), [range.from, range.to]);
  const [open, setOpen] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const byDay = new Map<string, StaffSession[]>();
  const list0 = (sessions.data ?? []).filter((s) => tab === 'upcoming' || new Date(s.starts_at).getTime() < Date.now());
  for (const s of tab === 'past' ? [...list0].reverse() : list0) {
    const k = localDateKey(new Date(s.starts_at));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }
  const weekLabel = weeksBack === 0 ? 'This week' : weeksBack === 1 ? 'Last week' : `Week of ${formatKey(monday, { day: 'numeric', month: 'short' })}`;
  const weekTotals = tab === 'past' ? list0.filter((s) => s.status !== 'cancelled').reduce((t, s) => ({ classes: t.classes + 1, booked: t.booked + s.booked_count, attended: t.attended + (s.attended ?? 0) }), { classes: 0, booked: 0, attended: 0 }) : null;

  return (
    <div className="container-page max-w-3xl py-8">
      <p className="text-sm font-semibold text-muted">Hi {profile?.full_name?.split(' ')[0] || 'there'}</p>
      <h1 className="text-3xl font-black">{isAdmin ? 'All classes' : 'My classes'}</h1>
      <div className="mt-4 inline-flex rounded-full bg-canvas p-1" role="tablist">
        {(['upcoming', 'past'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setWeeksBack(0); }}
            className={`rounded-full px-5 py-2 text-sm font-bold transition ${tab === t ? 'bg-brand-600 text-white shadow' : 'text-ink-soft'}`}>{t === 'upcoming' ? 'Upcoming' : 'Past'}</button>
        ))}
      </div>
      {tab === 'upcoming' ? (
        <p className="mt-3 text-ink-soft">The next two weeks. Tap a class for who’s coming, to add someone at the door or to mark attendance. The check-in QR button appears 1 hour before class.</p>
      ) : (
        <>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-white p-2 shadow-sm">
            <button className="btn-outline btn-sm" onClick={() => setWeeksBack((w) => w + 1)}>‹ Earlier</button>
            <span className="text-center"><span className="block font-bold">{weekLabel}</span><span className="text-xs text-muted">{formatKey(monday, { day: 'numeric', month: 'short' })} – {formatKey(addDaysToKey(monday, 6), { day: 'numeric', month: 'short' })}</span></span>
            <button className="btn-outline btn-sm" disabled={weeksBack === 0} onClick={() => setWeeksBack((w) => Math.max(0, w - 1))}>Later ›</button>
          </div>
          {weekTotals && weekTotals.classes > 0 && <p className="mt-2 text-sm text-ink-soft"><strong>{weekTotals.classes}</strong> classes · <strong>{weekTotals.booked}</strong> booked · <strong>{weekTotals.attended}</strong> checked in / marked here. Tap a class to see who came and to fix attendance.</p>}
        </>
      )}

      <div className="mt-6 space-y-6">
        {sessions.loading && !sessions.data ? <PageSpinner /> : sessions.error ? <ErrorNotice error={sessions.error} onRetry={sessions.reload} /> :
          byDay.size === 0 ? (
            <EmptyState title="No classes to show">
              {tab === 'past' ? 'No classes that week.' : isAdmin ? 'No classes are scheduled in the next two weeks.' : 'If you teach at Drop, ask the studio to link your account to your instructor profile.'}
            </EmptyState>
          ) : [...byDay.entries()].map(([day, list]) => (
            <section key={day} aria-label={formatKey(day, { weekday: 'long', day: 'numeric', month: 'long' })}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted">
                {day === today ? 'Today' : day === addDaysToKey(today, 1) ? 'Tomorrow' : formatKey(day, { weekday: 'long', day: 'numeric', month: 'short' })}
              </h2>
              <ul className="space-y-2">
                {list.map((s) => {
                  const pct = Math.min(100, Math.round((s.booked_count / s.capacity) * 100));
                  return (
                    <li key={s.id}>
                      <button onClick={() => setOpen(s.id)}
                        className={`card w-full p-4 text-left transition hover:shadow-md ${s.status === 'cancelled' ? 'opacity-50' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-display text-lg font-extrabold">{fmt.time(s.starts_at)}–{fmt.time(s.ends_at)} · {s.title}</p>
                            <p className="text-sm text-muted">{s.style?.name}{isAdmin && s.instructor ? ` · ${s.instructor.full_name}` : ''}{s.room ? ` · ${s.room}` : ''}</p>
                          </div>
                          <p className="shrink-0 text-right font-display text-xl font-black tabular-nums">{s.booked_count}<span className="text-sm font-semibold text-muted">/{s.capacity}</span></p>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
                          <div className={`h-full rounded-full ${pct >= 100 ? 'bg-ink' : pct >= 67 ? 'bg-accent-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                          {s.status === 'cancelled' && <span className="chip bg-red-50 text-danger">Cancelled</span>}
                          {tab === 'past' && s.status !== 'cancelled' && <>
                            <span className="chip bg-[#dff5ea] text-success">✅ {s.attended ?? 0} here</span>
                            {(s.no_shows ?? 0) > 0 && <span className="chip bg-red-50 text-danger">{s.no_shows} no-show{s.no_shows === 1 ? '' : 's'}</span>}
                            {(s.late_cancels ?? 0) > 0 && <span className="chip bg-canvas text-muted">{s.late_cancels} late cancel{s.late_cancels === 1 ? '' : 's'}</span>}
                            {s.booked_count - (s.attended ?? 0) - (s.no_shows ?? 0) > 0 && <span className="chip bg-accent-100 text-ink">{s.booked_count - (s.attended ?? 0) - (s.no_shows ?? 0)} not marked</span>}
                          </>}
                          {s.birthdays > 0 && <span className="chip bg-accent-100 text-ink">🎂 {s.birthdays} birthday{s.birthdays > 1 ? 's' : ''}</span>}
                          {s.new_members > 0 && <span className="chip bg-brand-50 text-brand-700">{s.new_members} new</span>}
                        </div>
                      </button>
                      {s.status === 'scheduled' && Date.now() >= new Date(s.starts_at).getTime() - 3_600_000 && Date.now() < new Date(s.ends_at).getTime() && (
                        <button className="btn-accent mt-2 w-full" onClick={() => { setQrFor(s.id); setOpen(s.id); }}>📲 Show check-in QR</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>

      {open && <StaffRoster key={`${open}-${qrFor === open}`} sessionId={open} isAdmin={isAdmin} startWithQr={qrFor === open} onClose={() => { setOpen(null); setQrFor(null); }} onChanged={() => void sessions.reload()} />}
    </div>
  );
}
