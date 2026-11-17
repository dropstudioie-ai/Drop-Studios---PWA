import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { HALF_HOURS, REASON_LABEL, rentals, toMinutes, type RentalQuote } from '../lib/rentals';
import { checkout } from '../lib/payments';
import { formatPrice } from '../domain/money';
import { addDaysToKey, localDateKey, zonedTime } from '../domain/time';
import { messageFor } from '../domain/messages';
import { Field, Notice, Spinner } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';

const FEATURES = [
  ['📐', '100 m² dance room'], ['🪵', 'Laminated wooden floor'], ['🪞', 'Floor-to-ceiling mirrors'], ['🌈', 'RGB LED lights + black light'],
  ['🌬️', 'Wall fan + industrial air fans'], ['🚿', 'Bathroom with shower'], ['🍳', 'Fully fitted kitchen'], ['🛋️', 'Spacious reception area'],
];
const PHOTOS = [6, 1, 3, 7];
const euro = (c: number) => formatPrice(c, 'EUR');
const hm = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const DURATIONS = Array.from({ length: 23 }, (_, i) => 60 + i * 30);   // 1h … 12h
const durLabel = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ' 30' : ''}`;

/** /rent: rent the Drop room by the hour. */
export default function Rent() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const settings = useAsync(() => rentals.settings(), []);
  const today = localDateKey(new Date());
  const [day, setDay] = useState(addDaysToKey(today, 1));
  const [time, setTime] = useState('10:00');
  const [mins, setMins] = useState(120);
  const [party, setParty] = useState(false);
  const [weekly, setWeekly] = useState(false);
  const [group, setGroup] = useState('');
  const [people, setPeople] = useState('');
  const [purpose, setPurpose] = useState('');
  const [dj, setDj] = useState(0);
  const [promo, setPromo] = useState(0);
  const [agree, setAgree] = useState(false);
  const [quote, setQuote] = useState<RentalQuote | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string[] | null>(null);
  const start = useMemo(() => zonedTime(day, toMinutes(time)), [day, time]);
  const end = useMemo(() => new Date(start.getTime() + mins * 60e3), [start, mins]);
  const dayBusy = useAsync(() => rentals.busy(zonedTime(day, 0), zonedTime(addDaysToKey(day, 1), 0)), [day]);
  const idem = useMemo(() => crypto.randomUUID(), [day, time, mins, party, weekly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    setQuoteErr(null);
    rentals.quote(start, end, party, Math.min(dj, mins), party ? promo : 0).then((q) => { if (live) setQuote(q); }).catch((e) => { if (live) { setQuote(null); setQuoteErr(messageFor((e as Error).message)); } });
    return () => { live = false; };
  }, [start, end, party, dj, promo, mins, session?.user.id]);

  async function book() {
    if (!session) { navigate(`/login?next=${encodeURIComponent('/rent')}`); return; }
    setBusy(true); setError(null);
    try {
      const r = await rentals.request({ start, end, party, purpose, group, people: people ? Number(people) : null, recurring: weekly, djMinutes: Math.min(dj, mins), marketingWeeks: party ? promo : 0 });
      if (r.needs_approval) { setSent(r.reasons); setBusy(false); return; }
      const next = await checkout({ rental_booking_ids: r.booking_ids, idempotency_key: idem });
      if ('redirect' in next) window.location.href = next.redirect; else navigate(next.navigate);
    } catch (e) { setError(messageFor((e as { code?: string }).code ?? (e as Error).message)); setBusy(false); }
  }

  const s = settings.data;
  return (
    <div>
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-brand-600 opacity-50 blur-3xl" />
        <div className="container-page relative grid gap-8 py-10 md:grid-cols-2 sm:py-14">
          <div>
            <p className="chip bg-white/10 text-accent-400">Studio rental · Dublin 1</p>
            <h1 className="mt-3 text-4xl font-black leading-[0.95] sm:text-6xl">Rent the <span className="text-accent-500">Drop studio.</span></h1>
            <p className="mt-3 max-w-md text-white/80">Rehearsals, classes, workshops, photo and video shoots, parties. A 100 m² dance room in the city centre, by the hour, booked and paid in the app.</p>
            <ul className="mt-5 grid grid-cols-2 gap-2 text-sm">
              {FEATURES.map(([icon, label]) => <li key={label} className="flex items-center gap-2"><span aria-hidden>{icon}</span>{label}</li>)}
            </ul>
            <a href="#book" className="btn-accent mt-6 text-lg">Check availability</a>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PHOTOS.map((n) => <img key={n} src={`/studio/photo-${n}.webp`} alt="The Drop studio" className="aspect-[3/4] w-full rounded-2xl object-cover" loading="lazy" />)}
          </div>
        </div>
      </section>

      <section className="container-page py-10">
        <h2 className="text-2xl font-black sm:text-3xl">Prices</h2>
        {s && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="card p-4"><p className="font-bold">Monday – Friday</p><p className="mt-1 text-sm">{euro(s.weekday_cents)}/hour daytime</p><p className="text-sm">{euro(s.weekday_peak_cents)}/hour 18:00–22:00</p></div>
            <div className="card p-4"><p className="font-bold">Saturday</p><p className="mt-1 text-sm">{euro(s.saturday_cents)}/hour</p><p className="text-sm text-success">{euro(s.saturday_offer_cents)}/hour 17:00–20:00</p></div>
            <div className="card p-4"><p className="font-bold">Sunday</p><p className="mt-1 text-sm">{euro(s.sunday_cents)}/hour</p></div>
            <div className="card p-4 sm:col-span-3"><p className="font-bold">🎉 Parties</p><p className="mt-1 text-sm">{euro(s.party_cents)}/hour any day and time, plus a {euro(s.cleaning_fee_cents)} cleaning fee.</p></div>
          </div>
        )}
        <ul className="mt-4 space-y-1 text-sm text-ink-soft">
          <li>• Minimum 1 hour, in 30-minute steps. Bookings that cross price times are charged by the half hour.</li>
          <li>• Reschedule up to 24 hours before. Full refund if you cancel at least 7 days before.</li>
          <li>• Every week at the same time? Book it month by month: next month’s slot is kept for you until the end of the month.</li>
          <li>• First booking, early mornings or late nights (outside 07:00–24:00), or more than 12 weeks ahead: we confirm before you pay.</li>
        </ul>
      </section>

      <section id="book" className="bg-canvas py-10">
        <div className="container-page grid gap-8 lg:grid-cols-[1fr_380px]">
          {sent ? (
            <div className="card p-6 text-center lg:col-span-2">
              <p className="text-5xl">📨</p>
              <h2 className="mt-3 text-2xl font-black">Request sent!</h2>
              <p className="mt-2 text-ink-soft">The time is held for you while we check it ({sent.map((r) => REASON_LABEL[r] ?? r).join(', ')}). You’ll get an email as soon as it’s confirmed, with a link to pay.</p>
              <Link to="/account#rentals" className="btn-primary mt-5">My bookings</Link>
            </div>
          ) : (
            <>
              <div className="card space-y-4 p-5">
                <h2 className="text-2xl font-black">Book the studio</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Day"><input className="input" type="date" min={addDaysToKey(today, 0)} value={day} onChange={(e) => setDay(e.target.value)} /></Field>
                  <Field label="From"><select className="input" value={time} onChange={(e) => setTime(e.target.value)}>{HALF_HOURS.map((h) => <option key={h} value={h}>{h}</option>)}</select></Field>
                  <Field label="For"><select className="input" value={mins} onChange={(e) => setMins(Number(e.target.value))}>{DURATIONS.map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}</select></Field>
                </div>
                <div>
                  <p className="text-sm font-semibold">Already taken that day</p>
                  {dayBusy.data?.length ? (
                    <ul className="mt-1 flex flex-wrap gap-2 text-xs">{dayBusy.data.map((b, i) => <li key={i} className={`chip ${b.what === 'Drop class' ? 'bg-brand-50 text-brand-700' : 'bg-accent-50 text-accent-600'}`}>{hm(b.starts_at)}–{hm(b.ends_at)} · {b.what}</li>)}</ul>
                  ) : <p className="text-xs text-success">{dayBusy.loading ? '…' : 'The whole day is free.'}</p>}
                </div>
                <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={party} onChange={(e) => setParty(e.target.checked)} /><span><span className="font-semibold">It’s a party</span><span className="block text-sm text-ink-soft">{s ? `${euro(s.party_cents)}/hour + ${euro(s.cleaning_fee_cents)} cleaning fee` : ''}</span></span></label>
                <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} /><span><span className="font-semibold">Every week at this time</span><span className="block text-sm text-ink-soft">Book the rest of this month now; next month’s dates are kept for you until the end of the month.</span></span></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Group or company (optional)"><input className="input" value={group} onChange={(e) => setGroup(e.target.value)} maxLength={80} placeholder="e.g. Zouk team" /></Field>
                  <Field label="How many people?"><input className="input" type="number" min={1} max={200} value={people} onChange={(e) => setPeople(e.target.value)} /></Field>
                </div>
                <Field label="What’s it for?"><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} placeholder="Rehearsal, class, photo shoot, birthday party…" /></Field>
                <div className="rounded-2xl border border-line p-3">
                  <p className="font-semibold">Add-ons</p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <Field label={`🎧 DJ${s ? ` (${euro(s.dj_cents_per_hour)}/hour)` : ''}`}>
                      <select className="input" value={Math.min(dj, mins)} onChange={(e) => setDj(Number(e.target.value))}>
                        <option value={0}>No DJ</option>
                        {DURATIONS.filter((m) => m <= mins).map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}
                      </select>
                    </Field>
                    <Field label={`📣 Party promotion${s ? ` (${euro(s.marketing_cents_per_week)}/week)` : ''}`} hint={party ? 'On Drop’s social media and the reception TV.' : 'For parties.'}>
                      <select className="input" value={party ? promo : 0} disabled={!party} onChange={(e) => setPromo(Number(e.target.value))}>
                        <option value={0}>No promotion</option>
                        {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>)}
                      </select>
                    </Field>
                  </div>
                </div>
                <div className="rounded-2xl bg-canvas p-3 text-sm">
                  <p className="font-semibold">House rules</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">{(s?.house_rules ?? '').split('\n').filter(Boolean).map((r) => <li key={r}>{r}</li>)}</ul>
                  <label className="mt-2 flex items-start gap-2 font-semibold"><input type="checkbox" className="mt-0.5 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I’ve read the house rules and I’m responsible for my group.</label>
                </div>
              </div>
              <aside className="card h-fit space-y-3 p-5 lg:sticky lg:top-20">
                <p className="font-bold">{new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(start)}, {time}–{hm(end.toISOString())}{weekly ? ' · weekly' : ''}</p>
                {quoteErr && <Notice tone="warn">{quoteErr}</Notice>}
                {quote && !quoteErr && (
                  <>
                    <ul className="text-sm">
                      {quote.lines.map((l) => <li key={l.rate_cents} className="flex justify-between"><span>{durLabel(l.minutes).replace('h 30', '.5h').replace('h', ' h')} × {euro(l.rate_cents)}</span><span>{euro((l.rate_cents * l.minutes) / 60)}</span></li>)}
                      {quote.cleaning_cents > 0 && <li className="flex justify-between"><span>Cleaning fee</span><span>{euro(quote.cleaning_cents)}</span></li>}
                      {quote.dj_cents > 0 && <li className="flex justify-between"><span>DJ</span><span>{euro(quote.dj_cents)}</span></li>}
                      {quote.marketing_cents > 0 && <li className="flex justify-between"><span>Party promotion</span><span>{euro(quote.marketing_cents)}</span></li>}
                    </ul>
                    <p className="flex justify-between border-t border-line pt-2 text-lg font-black"><span>Total{weekly ? ' per date' : ''}</span><span>{euro(quote.total_cents)}</span></p>
                    {quote.approval_reasons.length > 0 && <Notice tone="info">We’ll confirm this booking before you pay ({quote.approval_reasons.map((r) => REASON_LABEL[r] ?? r).join(', ')}). The time is held for you meanwhile.</Notice>}
                  </>
                )}
                {error && <Notice tone="warn">{error}</Notice>}
                {!agree && <p className="text-center text-xs text-muted">Tick the house rules to book.</p>}
                <button className="btn-primary w-full text-lg" disabled={busy || !quote || Boolean(quoteErr) || !agree} onClick={() => void book()}>
                  {busy ? <Spinner className="h-5 w-5" /> : !session ? 'Sign in to book' : quote?.approval_reasons.length ? 'Send request' : 'Book & pay'}
                </button>
                <p className="text-center text-xs text-muted">Secure payment by Square (card, Apple Pay, Google Pay).</p>
              </aside>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
