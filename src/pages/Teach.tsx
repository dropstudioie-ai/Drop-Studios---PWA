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
  const range = useMemo(() => ({ from: zonedTime(today).toISOString(), to: zonedTime(addDaysToKey(today, 14)).toISOString() }), [today]);
  const sessions = useAsync(() => api.staffSessions(range.from, range.to), [range.from]);
  const [open, setOpen] = useState<string | null>(null);

  const byDay = new Map<string, StaffSession[]>();
  for (const s of sessions.data ?? []) {
    const k = localDateKey(new Date(s.starts_at));
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }

  return (
    <div className="container-page max-w-3xl py-8">
      <p className="text-sm font-semibold text-muted">Hi {profile?.full_name?.split(' ')[0] || 'there'}</p>
      <h1 className="text-3xl font-black">{isAdmin ? 'All classes' : 'My classes'}</h1>
      <p className="mt-1 text-ink-soft">The next two weeks. Tap a class for the list of who’s coming.</p>

      <div className="mt-6 space-y-6">
        {sessions.loading && !sessions.data ? <PageSpinner /> : sessions.error ? <ErrorNotice error={sessions.error} onRetry={sessions.reload} /> :
          byDay.size === 0 ? (
            <EmptyState title="No classes to show">
              {isAdmin ? 'No classes are scheduled in the next two weeks.' : 'If you teach at Drop, ask the studio to link your account to your instructor profile.'}
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
                          {s.birthdays > 0 && <span className="chip bg-accent-100 text-ink">🎂 {s.birthdays} birthday{s.birthdays > 1 ? 's' : ''}</span>}
                          {s.new_members > 0 && <span className="chip bg-brand-50 text-brand-700">{s.new_members} new</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
      </div>

      {open && <StaffRoster sessionId={open} isAdmin={isAdmin} onClose={() => setOpen(null)} onChanged={() => void sessions.reload()} />}
    </div>
  );
}
