import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { REASON_LABEL, rentals, STATUS_LABEL, type AdminRental, type RentalSettings } from '../../lib/rentals';
import { cancelRental } from '../../lib/payments';
import { formatPrice, parseEurosToCents } from '../../domain/money';
import { messageFor } from '../../domain/messages';
import { ErrorNotice, Field, PageSpinner, Spinner, useToast } from '../../components/ui';
import { Section } from './shared';

const euro = (c: number) => formatPrice(c, 'EUR');
const when = (a: string, b: string) => {
  const d = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(a));
  const t = (x: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(x));
  return `${d}, ${t(a)}–${t(b)}`;
};

function Request({ r, count, onDone }: { r: AdminRental; count: number; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    try { await rentals.decide(r.booking_id, approve, note); toast(approve ? 'Approved: they’ve been asked to pay' : 'Declined: they’ve been told'); onDone(); }
    catch (e) { toast(messageFor((e as Error).message), 'error'); } finally { setBusy(false); }
  };
  return (
    <li className="card border-2 border-accent-500 p-4">
      <p className="font-bold">{r.group_name ?? r.renter} · {when(r.starts_at, r.ends_at)}{r.series ? ` · weekly (${count} dates this month)` : ''}{r.is_party ? ' · 🎉 party' : ''}</p>
      <p className="text-sm">{r.renter} · {r.renter_email}{r.renter_phone ? ` · ${r.renter_phone}` : ''}</p>
      <p className="text-sm text-muted">{r.purpose ?? 'No purpose given'}{r.people ? ` · ${r.people} people` : ''} · {euro(r.total_cents)}{r.series ? ' per date' : ''}</p>
      <p className="mt-1 text-sm font-semibold text-accent-600">Needs you because: {r.reasons.map((x) => REASON_LABEL[x] ?? x).join(', ')}</p>
      <input className="input mt-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for them (e.g. house rules, key pickup)" />
      <div className="mt-2 flex gap-2">
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => void decide(true)}>{busy ? <Spinner className="h-4 w-4" /> : 'Approve'}</button>
        <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void decide(false)}>Decline</button>
      </div>
    </li>
  );
}

function Prices({ s, onSaved }: { s: RentalSettings; onSaved: () => void }) {
  const toast = useToast();
  const fields: [keyof RentalSettings, string][] = [['weekday_cents', 'Mon–Fri daytime'], ['weekday_peak_cents', 'Mon–Fri 18:00–22:00'], ['saturday_cents', 'Saturday'], ['saturday_offer_cents', 'Saturday 17:00–20:00'], ['sunday_cents', 'Sunday'], ['party_cents', 'Parties (per hour)'], ['cleaning_fee_cents', 'Party cleaning fee']];
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k]) => [k, (Number(s[k]) / 100).toFixed(2)])));
  const save = async () => {
    const patch: Partial<RentalSettings> = {};
    for (const [k] of fields) { const c = parseEurosToCents(v[k]); if (c === null) { toast('Please check the prices', 'error'); return; } (patch as Record<string, number>)[k] = c; }
    try { await rentals.saveSettings(patch); toast('Prices saved. New bookings use them.'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Section title="Prices (€ per hour)">
      <div className="grid gap-3 sm:grid-cols-4">{fields.map(([k, label]) => <Field key={k} label={label}><input className="input" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div>
      <button className="btn-outline btn-sm mt-3" onClick={() => void save()}>Save prices</button>
    </Section>
  );
}

export default function AdminRentals() {
  const toast = useToast();
  const from = new Date(Date.now() - 7 * 864e5), to = new Date(Date.now() + 16 * 7 * 864e5);
  const list = useAsync(() => rentals.admin(from, to), []);
  const settings = useAsync(() => rentals.settings(), []);
  const [busy, setBusy] = useState<string | null>(null);
  if (list.loading && !list.data) return <PageSpinner />;
  if (list.error) return <ErrorNotice error={list.error} onRetry={list.reload} />;
  const rows = list.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending_approval');
  const firstOfSeries = pending.filter((r, i) => !r.series_id || pending.findIndex((x) => x.series_id === r.series_id) === i);
  const upcoming = rows.filter((r) => new Date(r.ends_at) > new Date() && ['confirmed', 'awaiting_payment', 'held'].includes(r.status));
  const weekRevenue = upcoming.filter((r) => r.status === 'confirmed' && new Date(r.starts_at).getTime() < Date.now() + 7 * 864e5).reduce((n, r) => n + r.total_cents, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="chip bg-accent-50 text-accent-600">⏳ {firstOfSeries.length} to approve</span>
        <span className="chip bg-brand-50 text-brand-700">📅 {upcoming.filter((r) => r.status === 'confirmed').length} confirmed upcoming</span>
        <span className="chip bg-success/10 text-success">💶 {euro(weekRevenue)} booked in the next 7 days</span>
        <Link to="/rent" className="chip bg-canvas font-semibold">Open the booking page ↗</Link>
      </div>
      <Section title="Requests waiting for you">
        {firstOfSeries.length ? <ul className="space-y-3">{firstOfSeries.map((r) => <Request key={r.booking_id} r={r} count={pending.filter((x) => r.series_id && x.series_id === r.series_id).length || 1} onDone={list.reload} />)}</ul>
          : <p className="text-sm text-muted">Nothing to approve. 🎉</p>}
      </Section>
      <Section title="Upcoming bookings">
        {upcoming.length ? (
          <ul className="divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.booking_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{when(r.starts_at, r.ends_at)}</strong> · {r.group_name ?? r.renter}{r.is_party ? ' 🎉' : ''}{r.series ? ' · weekly' : ''}
                  <span className="block text-xs text-muted">{STATUS_LABEL[r.status]} · {euro(r.total_cents)} · {r.renter}{r.renter_phone ? ` · ${r.renter_phone}` : ''}{r.purpose ? ` · ${r.purpose}` : ''}</span></span>
                <button className="btn-ghost btn-sm text-danger" disabled={busy === r.booking_id} onClick={async () => {
                  const refund = r.status === 'confirmed' ? confirm('Refund them in full? (OK = refund, Cancel = no refund)') : false;
                  if (!confirm(`Cancel ${r.group_name ?? r.renter}'s booking on ${when(r.starts_at, r.ends_at)}? They'll be told by email.`)) return;
                  setBusy(r.booking_id);
                  try { const x = await cancelRental(r.booking_id, refund); toast(x.refund_cents ? `Cancelled and ${euro(x.refund_cents)} refunded` : 'Cancelled'); list.reload(); }
                  catch (e) { toast(messageFor((e as { code?: string }).code ?? (e as Error).message), 'error'); } finally { setBusy(null); }
                }}>Cancel</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No bookings yet.</p>}
      </Section>
      {settings.data && <Prices s={settings.data} onSaved={settings.reload} />}
    </div>
  );
}
