import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import type { ClassSession } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { useAuth } from '../auth/AuthProvider';
import { addDaysToKey, diffDays, formatKey, localDateKey, STUDIO_TZ, weekStartKey, zonedTime } from '../domain/time';
import { ClassCard } from '../components/ClassCard';
import { BookingSheet } from '../components/BookingSheet';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { EmptyState, ErrorNotice, PageSpinner } from '../components/ui';

export default function Timetable() {
  const { session: authSession } = useAuth();
  const [params, setParams] = useSearchParams();
  const todayKey = localDateKey(new Date());
  const thisWeek = weekStartKey(todayKey);

  const settings = useAsync(() => api.settings(), []);
  const windowDays = settings.data?.booking_window_days ?? 21;
  const lastWeek = weekStartKey(addDaysToKey(todayKey, windowDays));
  const maxOffset = Math.max(0, diffDays(thisWeek, lastWeek) / 7);

  const offset = Math.min(Math.max(Number(params.get('week') ?? 0) || 0, 0), maxOffset);
  const weekKey = addDaysToKey(thisWeek, offset * 7);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToKey(weekKey, i)), [weekKey]);

  const [selectedDay, setSelectedDay] = useState<string>(() => (offset === 0 ? todayKey : weekKey));
  const activeDay = days.includes(selectedDay) ? selectedDay : days[0];
  const styleFilter = params.get('style');

  const range = useMemo(() => ({
    from: zonedTime(weekKey, 0, STUDIO_TZ).toISOString(),
    to: zonedTime(addDaysToKey(weekKey, 7), 0, STUDIO_TZ).toISOString(),
  }), [weekKey]);

  const styles = useAsync(() => api.styles(), []);
  const sessions = useAsync(() => api.sessions(range.from, range.to), [range.from]);
  const myBookings = useAsync(
    async () => (authSession ? api.myBookingsBetween(range.from, range.to) : []),
    [range.from, authSession?.user.id],
  );
  const bookedIds = new Set((myBookings.data ?? []).map((b) => b.session_id));

  const [open, setOpen] = useState<ClassSession | null>(null);
  const openById = useCallback(async (id: string) => {
    const found = sessions.data?.find((s) => s.id === id);
    setOpen(found ?? (await api.session(id)));
  }, [sessions.data]);

  const filtered = (sessions.data ?? []).filter((s) => !styleFilter || s.style?.slug === styleFilter);
  const byDay = new Map<string, ClassSession[]>(days.map((d) => [d, []]));
  for (const s of filtered) byDay.get(localDateKey(new Date(s.starts_at)))?.push(s);

  const setWeek = (w: number) => {
    const next = new URLSearchParams(params);
    if (w === 0) next.delete('week'); else next.set('week', String(w));
    setParams(next, { replace: true });
    setSelectedDay(w === 0 ? todayKey : addDaysToKey(thisWeek, w * 7));
  };
  const setStyle = (slug: string | null) => {
    const next = new URLSearchParams(params);
    if (slug) next.set('style', slug); else next.delete('style');
    setParams(next, { replace: true });
  };

  const refresh = () => {
    void sessions.reload();
    void myBookings.reload();
  };

  return (
    <div className="container-page py-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black sm:text-4xl">Weekly Timetable</h1>
          <p className="mt-1 text-ink-soft">Book up to {Math.round(windowDays / 7)} weeks ahead.</p>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-white p-1">
          <button className="btn-sm btn-ghost" onClick={() => setWeek(offset - 1)} disabled={offset <= 0} aria-label="Previous week"><ChevronLeft /></button>
          <span className="min-w-40 text-center text-sm font-semibold">
            {offset === 0 ? 'This week' : offset === 1 ? 'Next week' : `${formatKey(days[0], { day: 'numeric', month: 'short' })} – ${formatKey(days[6], { day: 'numeric', month: 'short' })}`}
          </span>
          <button className="btn-sm btn-ghost" onClick={() => setWeek(offset + 1)} disabled={offset >= maxOffset} aria-label="Next week"><ChevronRight /></button>
        </div>
      </div>

      {styles.data && styles.data.length > 0 && (
        <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by dance style">
          <button onClick={() => setStyle(null)} className={`chip shrink-0 border px-3 py-2 text-sm ${!styleFilter ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>All styles</button>
          {styles.data.map((s) => (
            <button key={s.id} onClick={() => setStyle(s.slug)} aria-pressed={styleFilter === s.slug}
              className={`chip shrink-0 border px-3 py-2 text-sm ${styleFilter === s.slug ? 'border-transparent text-white' : 'border-line bg-white'}`}
              style={styleFilter === s.slug ? { background: s.color } : undefined}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}
            </button>
          ))}
        </div>
      )}

      {/* Mobile: day tabs */}
      <div className="-mx-4 mt-5 flex gap-1.5 overflow-x-auto px-4 md:hidden" role="tablist" aria-label="Day">
        {days.map((d) => {
          const active = d === activeDay;
          const count = byDay.get(d)?.length ?? 0;
          return (
            <button key={d} role="tab" aria-selected={active} onClick={() => setSelectedDay(d)}
              className={`flex min-w-[3.25rem] flex-1 flex-col items-center rounded-xl py-2 ${active ? 'bg-brand-600 text-white' : 'bg-white text-ink'} ${d < todayKey ? 'opacity-50' : ''}`}>
              <span className="text-[11px] font-semibold uppercase">{formatKey(d, { weekday: 'short' })}</span>
              <span className="font-display text-lg font-extrabold">{formatKey(d, { day: 'numeric' })}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${count ? (active ? 'bg-accent-400' : 'bg-brand-500') : 'bg-transparent'}`} />
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {sessions.loading && !sessions.data ? <PageSpinner /> : sessions.error ? <ErrorNotice error={sessions.error} onRetry={sessions.reload} /> : (
          <>
            <div className="space-y-2.5 md:hidden" role="tabpanel">
              <h2 className="sr-only">{formatKey(activeDay, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
              {(byDay.get(activeDay) ?? []).length === 0 ? (
                <EmptyState title="No classes this day">{styleFilter ? 'Try another style or day.' : 'Check another day.'}</EmptyState>
              ) : byDay.get(activeDay)!.map((s) => (
                <ClassCard key={s.id} session={s} booked={bookedIds.has(s.id)} onOpen={() => setOpen(s)} />
              ))}
            </div>

            <div className="hidden grid-cols-7 gap-2 md:grid">
              {days.map((d) => (
                <section key={d} aria-label={formatKey(d, { weekday: 'long', day: 'numeric', month: 'long' })}>
                  <h2 className={`mb-2 rounded-lg px-2 py-2 text-center text-sm ${d === todayKey ? 'bg-brand-600 text-white' : 'bg-white text-ink'}`}>
                    <span className="block text-xs font-semibold uppercase opacity-80">{formatKey(d, { weekday: 'short' })}</span>
                    <span className="font-display text-lg font-extrabold">{formatKey(d, { day: 'numeric', month: 'short' })}</span>
                  </h2>
                  <div className="space-y-2">
                    {(byDay.get(d) ?? []).map((s) => (
                      <ClassCard key={s.id} compact session={s} booked={bookedIds.has(s.id)} onOpen={() => setOpen(s)} />
                    ))}
                    {(byDay.get(d) ?? []).length === 0 && <p className="py-6 text-center text-xs text-muted">No classes</p>}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      <BookingSheet session={open} onClose={() => setOpen(null)} onChanged={refresh} onOpenSession={(id) => void openById(id)} />
    </div>
  );
}
