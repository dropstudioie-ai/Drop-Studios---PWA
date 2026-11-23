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
  ['🔊', 'JBL PartyBox sound system'], ['🌬️', 'Wall fan + industrial air fans'], ['🚿', 'Bathroom with shower'], ['🍳', 'Fully fitted kitchen'], ['🛋️', 'Spacious reception area'],
];
const PHOTOS = [19, 25, 18, 17];
const euro = (c: number) => formatPrice(c, 'EUR');
const hm = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
const DURATIONS = Array.from({ length: 23 }, (_, i) => 60 + i * 30);   // 1h … 12h
const durLabel = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ' 30' : ''}`;
const QUICK_DURATIONS = [60, 90, 120, 180, 240];

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
  const next14 = Array.from({ length: 14 }, (_, i) => addDaysToKey(today, i));
  const openFrom = s?.open_from_min ?? 420, openTo = s?.open_to_min ?? 1440;
  const openTimes = HALF_HOURS.filter((h) => toMinutes(h) >= openFrom && toMinutes(h) + 60 <= openTo);
  // A start time is taken when the chosen length from it would overlap a class or another booking.
  const clash = (h: string) => {
    const a = zonedTime(day, toMinutes(h)).getTime(), b = a + mins * 60e3;
    return (dayBusy.data ?? []).some((x) => new Date(x.starts_at).getTime() < b && new Date(x.ends_at).getTime() > a) || (day === today && a < Date.now());
  };
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

      <section className="container-page grid items-center gap-6 pt-10 md:grid-cols-[1fr_1.1fr]">
        <div className="grid grid-cols-2 gap-2">
          <img src="/studio/sound-front.webp" alt="The studio's JBL PartyBox 310 speaker with its light show" className="aspect-[3/4] w-full rounded-2xl object-cover" loading="lazy" />
          <img src="/studio/sound-back.webp" alt="The speaker’s inputs: two microphone inputs, AUX in and USB" className="aspect-[3/4] w-full rounded-2xl object-cover" loading="lazy" />
        </div>
        <div>
          <p className="chip bg-accent-50 text-accent-600">Included with every booking</p>
          <h2 className="mt-2 text-2xl font-black sm:text-3xl">🔊 The sound system</h2>
          <p className="mt-2 text-ink-soft">A JBL PartyBox 310: big, room-filling sound with a built-in light show that moves to the beat.</p>
          <ul className="mt-3 space-y-1 text-sm">
            <li>• Play from your phone over Bluetooth</li>
            <li>• Two microphone inputs (one also takes a guitar), each with its own volume</li>
            <li>• AUX input and USB, for a laptop or a music stick</li>
            <li>• Want a DJ for your party? Add one when you book.</li>
          </ul>
        </div>
      </section>

      <section className="container-page py-10">
        <h2 className="text-2xl font-black sm:text-3xl">Prices</h2>
        {s && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <PriceCard tone="from-brand-600 to-brand-400" emoji="💼" title="Monday – Friday" lines={[`${euro(s.weekday_cents)}/hour daytime`, `${euro(s.weekday_peak_cents)}/hour 18:00–22:00`]} />
            <PriceCard tone="from-accent-600 to-accent-400" emoji="☀️" title="Saturday" lines={[`${euro(s.saturday_cents)}/hour`]} badge={`${euro(s.saturday_offer_cents)}/hour 17:00–20:00`} />
            <PriceCard tone="from-[#6d28d9] to-[#a78bfa]" emoji="🌙" title="Sunday" lines={[`${euro(s.sunday_cents)}/hour`]} />
            <div className="sm:col-span-3"><PriceCard tone="from-[#db2777] to-[#fb7185]" emoji="🎉" title="Parties" lines={[`${euro(s.party_cents)}/hour any day and time, plus a ${euro(s.cleaning_fee_cents)} cleaning fee`, 'Add a DJ or party promotion when you book']} /></div>
          </div>
        )}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[['⏱️', 'Minimum 1 hour, in 30-minute steps. Bookings that cross price times are charged by the half hour.'],
            ['🔁', 'Reschedule up to 24 hours before. Full refund if you cancel at least 7 days before.'],
            ['📅', 'Every week at the same time? Book month by month: next month’s slot is kept for you until the end of the month.'],
            ['✅', 'First booking, early mornings or late nights (outside 07:00–24:00), or more than 12 weeks ahead: we confirm before you pay.']].map(([e, t]) => (
            <p key={t} className="flex gap-3 rounded-2xl bg-brand-50 p-3 text-sm text-ink-soft"><span className="text-xl">{e}</span><span>{t}</span></p>
          ))}
        </div>
      </section>

      <section id="book" className="bg-gradient-to-b from-brand-50 via-accent-50 to-canvas py-10">
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
              <div className="min-w-0 space-y-5">
                <h2 className="text-3xl font-black">Book the studio</h2>

                <Step n={1} title="Pick a day" tone="bg-brand-600">
                  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                    {next14.map((k) => {
                      const d = new Date(`${k}T12:00:00Z`);
                      const on = k === day;
                      return (
                        <button key={k} type="button" onClick={() => setDay(k)}
                          className={`flex w-16 shrink-0 flex-col items-center rounded-2xl border-2 py-2 transition ${on ? 'border-brand-600 bg-brand-600 text-white shadow-lg shadow-brand-600/30' : 'border-line bg-white hover:border-brand-400'}`}>
                          <span className="text-[11px] font-bold uppercase">{new Intl.DateTimeFormat('en-IE', { weekday: 'short', timeZone: 'UTC' }).format(d)}</span>
                          <span className="font-display text-2xl font-black">{d.getUTCDate()}</span>
                          <span className="text-[11px]">{new Intl.DateTimeFormat('en-IE', { month: 'short', timeZone: 'UTC' }).format(d)}</span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">Another date:
                    <input className="input max-w-48" type="date" min={today} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></label>
                </Step>

                <Step n={2} title="How long?" tone="bg-accent-500">
                  <div className="flex flex-wrap gap-2">
                    {QUICK_DURATIONS.map((m) => (
                      <button key={m} type="button" onClick={() => setMins(m)}
                        className={`rounded-full border-2 px-4 py-2 font-bold transition ${mins === m ? 'border-accent-500 bg-accent-500 text-ink shadow-lg shadow-accent-500/30' : 'border-line bg-white hover:border-accent-400'}`}>{durLabel(m)}</button>
                    ))}
                    <select className="input w-auto" aria-label="Other length" value={QUICK_DURATIONS.includes(mins) ? '' : mins} onChange={(e) => e.target.value && setMins(Number(e.target.value))}>
                      <option value="">Longer…</option>
                      {DURATIONS.filter((m) => !QUICK_DURATIONS.includes(m)).map((m) => <option key={m} value={m}>{durLabel(m)}</option>)}
                    </select>
                  </div>
                </Step>

                <Step n={3} title="Start time" tone="bg-[#12b5a2]" hint="Grey times are taken (Drop classes or other bookings).">
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    {openTimes.map((h) => {
                      const taken = clash(h);
                      const on = h === time;
                      return (
                        <button key={h} type="button" disabled={taken} onClick={() => setTime(h)}
                          className={`rounded-xl border-2 py-2 text-sm font-bold transition ${on ? 'border-[#12b5a2] bg-[#12b5a2] text-white shadow-lg shadow-[#12b5a2]/30' : taken ? 'cursor-not-allowed border-transparent bg-line/60 text-muted line-through' : 'border-line bg-white hover:border-[#12b5a2]'}`}>{h}</button>
                      );
                    })}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">Early or late start:
                    <select className="input w-auto" value={openTimes.includes(time) ? '' : time} onChange={(e) => e.target.value && setTime(e.target.value)}>
                      <option value="">Choose…</option>
                      {HALF_HOURS.filter((h) => !openTimes.includes(h)).map((h) => <option key={h} value={h}>{h}</option>)}
                    </select></label>
                  {dayBusy.data?.length ? (
                    <ul className="mt-3 flex flex-wrap gap-2 text-xs">{dayBusy.data.map((b, i) => <li key={i} className={`chip ${b.what === 'Drop class' ? 'bg-brand-50 text-brand-700' : 'bg-accent-50 text-accent-600'}`}>{hm(b.starts_at)}–{hm(b.ends_at)} · {b.what}</li>)}</ul>
                  ) : <p className="mt-3 text-xs font-semibold text-success">{dayBusy.loading ? '…' : '✓ The whole day is free.'}</p>}
                </Step>

                <Step n={4} title="What kind of booking?" tone="bg-[#8b5cf6]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Toggle on={!party} onClick={() => setParty(false)} emoji="💃" title="Class, rehearsal or shoot" text="Regular hourly price" />
                    <Toggle on={party} onClick={() => setParty(true)} emoji="🎉" title="Party" text={s ? `${euro(s.party_cents)}/hour + ${euro(s.cleaning_fee_cents)} cleaning` : ''} />
                  </div>
                  <div className="mt-3"><Toggle on={weekly} onClick={() => setWeekly(!weekly)} emoji="🔁" title="Every week at this time" text="Book the rest of this month now; next month’s dates are kept for you." check /></div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Group or company (optional)"><input className="input" value={group} onChange={(e) => setGroup(e.target.value)} maxLength={80} placeholder="e.g. Zouk team" /></Field>
                    <Field label="How many people?"><input className="input" type="number" min={1} max={200} value={people} onChange={(e) => setPeople(e.target.value)} /></Field>
                  </div>
                  <div className="mt-3"><Field label="What’s it for?"><input className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} placeholder="Rehearsal, class, photo shoot, birthday party…" /></Field></div>
                </Step>

                <Step n={5} title="Extras" tone="bg-[#db2777]">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className={`rounded-2xl border-2 p-4 transition ${dj ? 'border-[#db2777] bg-[#fdf2f8]' : 'border-line bg-white'}`}>
                      <p className="text-2xl">🎧</p>
                      <p className="font-bold">DJ{s ? ` · ${euro(s.dj_cents_per_hour)}/hour` : ''}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[0, 60, 120, 180].filter((m) => m <= mins).map((m) => (
                          <button key={m} type="button" onClick={() => setDj(m)} className={`rounded-full border-2 px-3 py-1 text-sm font-bold ${Math.min(dj, mins) === m ? 'border-[#db2777] bg-[#db2777] text-white' : 'border-line bg-white'}`}>{m ? durLabel(m) : 'No DJ'}</button>
                        ))}
                      </div>
                    </div>
                    <div className={`rounded-2xl border-2 p-4 transition ${party && promo ? 'border-[#db2777] bg-[#fdf2f8]' : 'border-line bg-white'} ${party ? '' : 'opacity-60'}`}>
                      <p className="text-2xl">📣</p>
                      <p className="font-bold">Party promotion{s ? ` · ${euro(s.marketing_cents_per_week)}/week` : ''}</p>
                      <p className="text-xs text-muted">{party ? 'On Drop’s social media and the reception TV.' : 'For parties.'}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[0, 1, 2, 3, 4].map((w) => (
                          <button key={w} type="button" disabled={!party} onClick={() => setPromo(w)} className={`rounded-full border-2 px-3 py-1 text-sm font-bold ${(party ? promo : 0) === w ? 'border-[#db2777] bg-[#db2777] text-white' : 'border-line bg-white'}`}>{w ? `${w} wk` : 'None'}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </Step>

                <Step n={6} title="House rules" tone="bg-ink">
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">{(s?.house_rules ?? '').split('\n').filter(Boolean).map((r) => <li key={r}>{r}</li>)}</ul>
                  <button type="button" onClick={() => setAgree(!agree)}
                    className={`mt-3 flex w-full items-center gap-3 rounded-2xl border-2 p-3 text-left font-semibold transition ${agree ? 'border-success bg-[#dff5ea]' : 'border-accent-400 bg-accent-50'}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white ${agree ? 'bg-success' : 'border-2 border-accent-500 bg-white'}`}>{agree ? '✓' : ''}</span>
                    I’ve read the house rules and I’m responsible for my group.
                  </button>
                </Step>
              </div>

              <aside className="h-fit overflow-hidden rounded-3xl bg-white shadow-xl lg:sticky lg:top-20">
                <div className="bg-gradient-to-br from-brand-700 to-brand-500 p-5 text-white">
                  <p className="text-xs font-bold uppercase tracking-wide text-white/80">Your booking</p>
                  <p className="mt-1 font-display text-2xl font-black">{new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(start)}</p>
                  <p className="text-lg font-semibold">{time}–{hm(end.toISOString())} · {durLabel(mins)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <span className="chip bg-white/20 text-white">{party ? '🎉 Party' : '💃 Studio hire'}</span>
                    {weekly && <span className="chip bg-white/20 text-white">🔁 Weekly</span>}
                    {Math.min(dj, mins) > 0 && <span className="chip bg-white/20 text-white">🎧 DJ</span>}
                    {party && promo > 0 && <span className="chip bg-white/20 text-white">📣 Promotion</span>}
                  </div>
                </div>
                <div className="space-y-3 p-5">
                  {quoteErr && <Notice tone="warn">{quoteErr}</Notice>}
                  {quote && !quoteErr && (
                    <>
                      <ul className="space-y-1 text-sm">
                        {quote.lines.map((l) => <li key={l.rate_cents} className="flex justify-between"><span>{durLabel(l.minutes).replace('h 30', '.5h').replace('h', ' h')} × {euro(l.rate_cents)}</span><span>{euro((l.rate_cents * l.minutes) / 60)}</span></li>)}
                        {quote.cleaning_cents > 0 && <li className="flex justify-between"><span>Cleaning fee</span><span>{euro(quote.cleaning_cents)}</span></li>}
                        {quote.dj_cents > 0 && <li className="flex justify-between"><span>DJ</span><span>{euro(quote.dj_cents)}</span></li>}
                        {quote.marketing_cents > 0 && <li className="flex justify-between"><span>Party promotion</span><span>{euro(quote.marketing_cents)}</span></li>}
                      </ul>
                      <p className="flex items-baseline justify-between border-t border-line pt-3"><span className="font-bold">Total{weekly ? ' per date' : ''}</span><span className="font-display text-3xl font-black text-brand-700">{euro(quote.total_cents)}</span></p>
                      {quote.approval_reasons.length > 0 && <Notice tone="info">We’ll confirm this booking before you pay ({quote.approval_reasons.map((r) => REASON_LABEL[r] ?? r).join(', ')}). The time is held for you meanwhile.</Notice>}
                    </>
                  )}
                  {error && <Notice tone="warn">{error}</Notice>}
                  {!agree && <p className="text-center text-xs font-semibold text-accent-600">Tick the house rules (step 6) to book.</p>}
                  <button className="btn-accent w-full text-lg shadow-lg shadow-accent-500/30" disabled={busy || !quote || Boolean(quoteErr) || !agree} onClick={() => void book()}>
                    {busy ? <Spinner className="h-5 w-5" /> : !session ? 'Sign in to book' : quote?.approval_reasons.length ? 'Send request' : 'Book & pay'}
                  </button>
                  <p className="text-center text-xs text-muted">Secure payment by Square (card, Apple Pay, Google Pay).</p>
                </div>
              </aside>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function PriceCard({ tone, emoji, title, lines, badge }: { tone: string; emoji: string; title: string; lines: string[]; badge?: string }) {
  return (
    <div className={`h-full rounded-2xl bg-gradient-to-br ${tone} p-5 text-white shadow-lg`}>
      <p className="text-3xl">{emoji}</p>
      <p className="mt-1 font-display text-xl font-black">{title}</p>
      {lines.map((l) => <p key={l} className="text-sm text-white/90">{l}</p>)}
      {badge && <p className="mt-2 inline-block rounded-full bg-white px-3 py-1 text-xs font-bold text-accent-600">🔥 Offer: {badge}</p>}
    </div>
  );
}

function Step({ n, title, tone, hint, children }: { n: number; title: string; tone: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl bg-white p-5 shadow-md">
      <div className="mb-3 flex items-center gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-lg font-black text-white ${tone}`}>{n}</span>
        <div><h3 className="text-lg font-black">{title}</h3>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      </div>
      {children}
    </section>
  );
}

function Toggle({ on, onClick, emoji, title, text, check }: { on: boolean; onClick: () => void; emoji: string; title: string; text: string; check?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`flex w-full items-center gap-3 rounded-2xl border-2 p-4 text-left transition ${on ? 'border-[#8b5cf6] bg-[#f5f3ff] shadow-md' : 'border-line bg-white hover:border-[#a78bfa]'}`}>
      <span className="text-3xl">{emoji}</span>
      <span className="flex-1"><span className="block font-bold">{title}</span><span className="block text-sm text-ink-soft">{text}</span></span>
      {check && <span className={`grid h-7 w-7 place-items-center rounded-lg text-white ${on ? 'bg-[#8b5cf6]' : 'border-2 border-line bg-white'}`}>{on ? '✓' : ''}</span>}
    </button>
  );
}
