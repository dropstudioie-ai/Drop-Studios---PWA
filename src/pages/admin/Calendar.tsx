import { useEffect, useMemo, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { rentals } from '../../lib/rentals';
import { addDaysToKey, localDateKey, zonedTime } from '../../domain/time';
import { PageSpinner } from '../../components/ui';

const hm = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const dayLabel = (key: string) => new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

/** Live studio calendar: Drop classes in orange, rentals in blue (refreshes every 30 seconds). */
export default function AdminCalendar() {
  const today = localDateKey(new Date());
  const monday = useMemo(() => { const d = new Date(`${today}T12:00:00Z`).getUTCDay(); return addDaysToKey(today, -((d + 6) % 7)); }, [today]);
  const [week, setWeek] = useState(0);
  const start = addDaysToKey(monday, week * 7);
  const [tick, setTick] = useState(0);
  useEffect(() => { const h = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(h); }, []);
  const events = useAsync(() => rentals.calendar(zonedTime(start, 0), zonedTime(addDaysToKey(start, 7), 0)), [start, tick]);
  if (events.loading && !events.data) return <PageSpinner />;
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button className="btn-ghost btn-sm" onClick={() => setWeek(week - 1)}>‹ Previous</button>
          <p className="font-bold">Week of {dayLabel(start)}</p>
          <button className="btn-ghost btn-sm" onClick={() => setWeek(week + 1)}>Next ›</button>
          {week !== 0 && <button className="btn-outline btn-sm" onClick={() => setWeek(0)}>This week</button>}
        </div>
        <p className="flex gap-3 text-sm"><span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#ff7a00]" />Drop classes</span><span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-[#2563eb]" />Studio rentals</span></p>
      </div>
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((d) => {
          const list = (events.data ?? []).filter((e) => localDateKey(new Date(e.starts_at)) === d);
          return (
            <div key={d} className={`rounded-2xl border p-2 ${d === today ? 'border-brand-600' : 'border-line'}`}>
              <p className="text-xs font-bold uppercase text-muted">{dayLabel(d)}</p>
              <ul className="mt-2 space-y-1.5">
                {list.map((e) => (
                  <li key={e.id} className={`rounded-xl p-2 text-xs text-white ${e.type === 'rental' ? 'bg-[#2563eb]' : 'bg-[#ff7a00]'}`}>
                    <p className="font-bold">{hm(e.starts_at)}–{hm(e.ends_at)}</p>
                    <p className="font-semibold">{e.title}</p>
                    {e.detail && <p className="opacity-90">{e.detail}</p>}
                  </li>
                ))}
                {!list.length && <li className="text-xs text-muted">Free all day</li>}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Updates live. To see it on your phone, add the calendar links from the Studio rental page.</p>
    </div>
  );
}
