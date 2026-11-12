import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { events, type StudioEvent } from '../../lib/events';
import { formatPrice } from '../../domain/money';
import { fmt } from '../../domain/time';
import { EventCard } from '../Events';
import { ErrorNotice, Field, Notice, PageSpinner, Sheet, Spinner, useToast } from '../../components/ui';

/** Admin: workshop requests to approve, and what's coming up (with decorations to get). */
export default function AdminEvents() {
  const list = useAsync(() => events.all(), []);
  const [deciding, setDeciding] = useState<StudioEvent | null>(null);
  if (list.loading && !list.data) return <PageSpinner />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const all = list.data!;
  const start = (e: StudioEvent) => e.session?.starts_at ?? e.starts_at ?? '';
  const pending = all.filter((e) => e.status === 'pending');
  const upcoming = all.filter((e) => e.status === 'published' && new Date(start(e)) > new Date()).sort((a, b) => start(a).localeCompare(start(b)));
  const past = all.filter((e) => !pending.includes(e) && !upcoming.includes(e));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">
          Instructors organise special classes (a theme on their own class, live straight away) and workshops (paid, outside the timetable, need your approval).
          Instructors are reminded in the last week of each month.
        </p>
        <Link to="/teach/events/new" className="btn-primary btn-sm">Organise an event</Link>
      </div>

      <section>
        <h2 className="text-xl font-black">Workshop requests</h2>
        {pending.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing waiting.</p> : (
          <ul className="mt-3 space-y-3">
            {pending.map((e) => (
              <div key={e.id}>
                <EventCard e={e} admin />
                <button className="btn-primary btn-sm mt-2" onClick={() => setDeciding(e)}>Approve or decline</button>
              </div>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-black">Coming up</h2>
        {upcoming.length === 0 ? <p className="mt-2 text-sm text-muted">No events coming up.</p> : (
          <>
            {upcoming.some((e) => e.decorations || e.extras) && (
              <div className="card mt-3 p-4">
                <p className="font-extrabold">🛍️ To get for the studio</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {upcoming.filter((e) => e.decorations || e.extras).map((e) => (
                    <li key={e.id}><strong>{fmt.dayMonth(start(e))} · {e.title}:</strong> {[e.decorations, e.extras].filter(Boolean).join(' · ')}</li>
                  ))}
                </ul>
              </div>
            )}
            <ul className="mt-3 space-y-3">{upcoming.map((e) => <EventCard key={e.id} e={e} admin />)}</ul>
          </>
        )}
      </section>

      <EarningsSummary list={all} />

      {past.length > 0 && (
        <section>
          <h2 className="text-xl font-black">Earlier</h2>
          <ul className="mt-3 space-y-3">{past.slice(0, 30).map((e) => <EventCard key={e.id} e={e} admin />)}</ul>
        </section>
      )}

      {deciding && <DecideSheet e={deciding} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); void list.reload(); }} />}
    </div>
  );
}

function DecideSheet({ e, onClose, onDone }: { e: StudioEvent; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await events.decide(e.id, approve, note);
      toast(approve ? `Approved and on the timetable. ${r.announced} people were told.` : 'Declined. The instructor has been told.');
      onDone();
    } catch (x) {
      setError((x as Error).message);
      setBusy(false);
    }
  }
  return (
    <Sheet open onClose={onClose} title={e.title}>
      <div className="space-y-3">
        <p className="text-sm">{e.instructor} · {e.starts_at && `${fmt.dateTime(e.starts_at)}–${fmt.time(e.ends_at!)}`}</p>
        <p className="text-sm">{e.capacity} places · {formatPrice(e.price_cents ?? 0)}{e.member_price_cents != null ? ` · members ${formatPrice(e.member_price_cents)}` : ''}</p>
        <Notice tone="info">Approving puts it on the timetable as a ticketed event and tells everyone who took {e.instructor}’s classes in the last 3 months.</Notice>
        <Field label="Note to the instructor (optional)"><input className="input" value={note} onChange={(x) => setNote(x.target.value)} placeholder="e.g. Great idea! We’ll get the lights." /></Field>
        {error && <ErrorNotice error={error} />}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 text-danger" disabled={busy} onClick={() => void decide(false)}>Decline</button>
          <button className="btn-primary flex-1" disabled={busy} onClick={() => void decide(true)}>{busy && <Spinner />}Approve</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Workshop ticket money per instructor (last 12 months). */
function EarningsSummary({ list }: { list: StudioEvent[] }) {
  const paid = list.filter((e) => e.kind === 'workshop' && e.ticket_revenue_cents > 0);
  if (paid.length === 0) return null;
  const by = new Map<string, { tickets: number; revenue: number; fees: number; instructor: number; studio: number }>();
  for (const e of paid) {
    const k = e.instructor ?? 'Instructor';
    const r = by.get(k) ?? { tickets: 0, revenue: 0, fees: 0, instructor: 0, studio: 0 };
    r.tickets += e.tickets_sold; r.revenue += e.ticket_revenue_cents; r.fees += e.fees_cents; r.instructor += e.instructor_earnings_cents; r.studio += e.studio_earnings_cents;
    by.set(k, r);
  }
  return (
    <section>
      <h2 className="text-xl font-black">Workshop earnings</h2>
      <p className="text-sm text-muted">Ticket sales in the last 12 months. Square’s card fee comes off first, then what’s left is split by each workshop’s instructor share. Refunded and test tickets aren’t counted.</p>
      <div className="card mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted">
            <tr><th className="p-3">Instructor</th><th className="p-3 text-right">Tickets</th><th className="p-3 text-right">Sales</th><th className="p-3 text-right">Fees</th><th className="p-3 text-right">Instructor</th><th className="p-3 text-right">Studio</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...by].map(([name, r]) => (
              <tr key={name}>
                <td className="p-3 font-semibold">{name}</td><td className="p-3 text-right">{r.tickets}</td><td className="p-3 text-right">{formatPrice(r.revenue)}</td><td className="p-3 text-right">{formatPrice(r.fees, 'EUR', { forceDecimals: true })}</td>
                <td className="p-3 text-right font-bold">{formatPrice(r.instructor, 'EUR', { forceDecimals: true })}</td><td className="p-3 text-right">{formatPrice(r.studio, 'EUR', { forceDecimals: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
