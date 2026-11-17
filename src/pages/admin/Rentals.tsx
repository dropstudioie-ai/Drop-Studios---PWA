import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { REASON_LABEL, rentals, STATUS_LABEL, type AdminRental, type RentalBlock, type RentalSettings } from '../../lib/rentals';
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
  const fields: [keyof RentalSettings, string][] = [['weekday_cents', 'Mon–Fri daytime'], ['weekday_peak_cents', 'Mon–Fri 18:00–22:00'], ['saturday_cents', 'Saturday'], ['saturday_offer_cents', 'Saturday 17:00–20:00'], ['sunday_cents', 'Sunday'], ['party_cents', 'Parties (per hour)'], ['cleaning_fee_cents', 'Party cleaning fee'], ['dj_cents_per_hour', 'DJ (per hour)'], ['marketing_cents_per_week', 'Party promotion (per week)']];
  const [rules, setRules] = useState(s.house_rules);
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(fields.map(([k]) => [k, (Number(s[k]) / 100).toFixed(2)])));
  const save = async () => {
    const patch: Partial<RentalSettings> = {};
    for (const [k] of fields) { const c = parseEurosToCents(v[k]); if (c === null) { toast('Please check the prices', 'error'); return; } (patch as Record<string, number>)[k] = c; }
    try { await rentals.saveSettings({ ...patch, house_rules: rules.trim() }); toast('Saved. New bookings use these prices and rules.'); onSaved(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Section title="Prices, add-ons and house rules">
      <div className="grid gap-3 sm:grid-cols-4">{fields.map(([k, label]) => <Field key={k} label={`${label} €`}><input className="input" inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div>
      <Field label="House rules (one per line; renters must accept them to book)"><textarea className="input mt-1 min-h-40" value={rules} onChange={(e) => setRules(e.target.value)} /></Field>
      <button className="btn-outline btn-sm mt-3" onClick={() => void save()}>Save</button>
    </Section>
  );
}

/** The door code (sent to renters only after they pay) and the calendar links for your phone. */
function AccessAndCalendar() {
  const toast = useToast();
  const priv = useAsync(() => rentals.privateSettings(), []);
  const [code, setCode] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  if (!priv.data) return null;
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-feed?token=${priv.data.calendar_token}`;
  const link = (type: string) => `${base}&type=${type}`.replace(/^https:/, 'webcal:');
  const copy = async (t: string) => { await navigator.clipboard?.writeText(t); toast('Link copied'); };
  return (
    <Section title="Front door code and calendar">
      <Field label="Front door code (sent to renters only after they pay)">
        <div className="flex gap-2">
          <input className="input font-mono" type={show ? 'text' : 'password'} value={code ?? priv.data.access_code ?? ''} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-ghost btn-sm" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          <button className="btn-outline btn-sm" disabled={code === null} onClick={async () => { try { await rentals.saveAccessCode(code ?? ''); toast('Door code saved'); priv.reload(); setCode(null); } catch (e) { toast((e as Error).message, 'error'); } }}>Save</button>
        </div>
      </Field>
      <p className="mt-4 text-sm font-semibold">Calendar on your phone</p>
      <p className="text-xs text-muted">Tap a link on your iPhone to subscribe (or copy it into Google Calendar → Other calendars → From URL). Set Drop classes to orange and Rentals to blue. Apple Calendar refreshes every few minutes; Google can take a few hours. The Calendar page here is always live.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <a className="btn-sm rounded-xl bg-[#ff7a00] px-3 py-2 font-semibold text-white" href={link('classes')}>📅 Drop classes</a>
        <a className="btn-sm rounded-xl bg-[#2563eb] px-3 py-2 font-semibold text-white" href={link('rentals')}>📅 Studio rentals</a>
        <button className="btn-ghost btn-sm" onClick={() => void copy(`${base}&type=classes`)}>Copy classes link</button>
        <button className="btn-ghost btn-sm" onClick={() => void copy(`${base}&type=rentals`)}>Copy rentals link</button>
      </div>
      <p className="mt-1 text-xs text-muted">Keep these links private: they show renters’ names and phone numbers.</p>
    </Section>
  );
}

/** Regular hires (other teachers' weekly classes): closed for rental. Months "to be confirmed" wait for the owner. */
function RegularHires() {
  const toast = useToast();
  const list = useAsync(() => rentals.blocks(new Date()), []);
  const [open, setOpen] = useState(false);
  const rows = list.data ?? [];
  if (!rows.length) return null;
  const dayOnly = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', weekday: 'long' }).format(new Date(iso));
  const t = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const by = (d: string) => new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  const weekly = [...new Map(rows.map((r) => [`${r.title}|${dayOnly(r.starts_at)}|${t(r.starts_at)}`, r])).values()];
  const pending = [...new Set(rows.filter((r) => r.confirm_by).map((r) => r.confirm_by!))];
  const decide = async (confirmBy: string, keep: boolean, title: string | null) => {
    if (!keep && !confirm(`Free ${title ?? 'all these'} times so people can rent them?`)) return;
    try { const n = await rentals.decideBlocks(confirmBy, keep, title); toast(keep ? `Confirmed (${n} dates stay closed)` : `Freed ${n} dates for rental`); list.reload(); }
    catch (e) { toast(messageFor((e as Error).message), 'error'); }
  };
  const remove = async (b: RentalBlock) => {
    if (!confirm(`Free ${b.title} on ${when(b.starts_at, b.ends_at)} for rental?`)) return;
    try { await rentals.removeBlock(b.id); toast('Freed'); list.reload(); } catch (e) { toast(messageFor((e as Error).message), 'error'); }
  };
  return (
    <Section title="Regular hires (closed for rental)">
      <ul className="space-y-1 text-sm">
        {weekly.map((r) => {
          const one = rows.filter((x) => x.title === r.title && dayOnly(x.starts_at) === dayOnly(r.starts_at) && t(x.starts_at) === t(r.starts_at));
          return <li key={r.id}><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2563eb]" /> <strong>{r.title}</strong> · {one.length > 1 ? `${dayOnly(r.starts_at)}s` : when(r.starts_at, r.ends_at).split(',')[0]}, {t(r.starts_at)}–{t(r.ends_at)} <span className="text-muted">· until {new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', day: 'numeric', month: 'short' }).format(new Date(one[one.length - 1].starts_at))}</span></li>;
        })}
      </ul>
      {pending.map((d) => {
        const titles = [...new Set(rows.filter((r) => r.confirm_by === d).map((r) => r.title))];
        return (
          <div key={d} className="mt-4 rounded-2xl border-2 border-accent-500 p-3">
            <p className="text-sm font-semibold">Please confirm by {by(d)}: do these stay in the new month?</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {titles.map((ti) => (
                <li key={ti} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{ti}</span>
                  <span className="flex gap-2">
                    <button className="btn-primary btn-sm" onClick={() => void decide(d, true, ti)}>Keep</button>
                    <button className="btn-ghost btn-sm" onClick={() => void decide(d, false, ti)}>Free</button>
                  </span>
                </li>
              ))}
            </ul>
            <button className="btn-outline btn-sm mt-3" onClick={() => void decide(d, true, null)}>Keep all</button>
          </div>
        );
      })}
      <button className="mt-3 text-sm font-semibold text-brand-700" onClick={() => setOpen(!open)}>{open ? 'Hide dates' : 'Free a single date (e.g. a week they cancel)'}</button>
      {open && (
        <ul className="mt-2 divide-y divide-line text-sm">
          {rows.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
              <span>{when(b.starts_at, b.ends_at)} · {b.title}{b.confirm_by ? <span className="text-muted"> · to be confirmed</span> : null}</span>
              <button className="btn-ghost btn-sm text-danger" onClick={() => void remove(b)}>Free</button>
            </li>
          ))}
        </ul>
      )}
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
      <RegularHires />
      <AccessAndCalendar />
      {settings.data && <Prices s={settings.data} onSaved={settings.reload} />}
    </div>
  );
}
