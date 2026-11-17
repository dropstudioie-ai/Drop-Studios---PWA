import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAsync } from '../lib/useAsync';
import { gifts, normaliseCode, type GiftablePlan, type GiftLookup } from '../lib/gifts';
import { checkout } from '../lib/payments';
import { formatPrice } from '../domain/money';
import { localDateKey } from '../domain/time';
import { classesLabel } from '../domain/plans';
import { messageFor } from '../domain/messages';
import { ErrorNotice, Field, Notice, PageSpinner, Spinner } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';

const GOLD_TEXT = 'bg-gradient-to-r from-[#b8902b] via-[#f7e08a] to-[#c9a227] bg-clip-text text-transparent';
const fullDate = (iso: string) => new Intl.DateTimeFormat('en-IE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' }).format(new Date(iso));

/** The black-and-gold gift card itself (screen and print). */
export function GiftCardVisual({ planName, code, to, from, small }: { planName: string; code?: string; to?: string | null; from?: string | null; small?: boolean }) {
  return (
    <div className={`relative mx-auto aspect-[1.6/1] w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#1a150b] via-[#0b0906] to-[#1d170c] p-[6%] text-[#f3e7c6] shadow-2xl ring-2 ring-[#c9a227] print:shadow-none ${small ? 'max-w-sm' : 'max-w-xl'}`}>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgba(255,236,170,0.14)_45%,transparent_60%)]" />
      <div className="absolute right-[9%] top-0 h-full w-[7%] bg-gradient-to-r from-[#8a6a1f] via-[#f0d27a] to-[#b8902b] opacity-90" />
      <div className="relative flex h-full flex-col justify-between">
        <div>
          <img src="/brand/drop-logo-white.svg" alt="Drop Studios" className="h-[14%] max-h-8 w-auto [filter:brightness(0)_saturate(100%)_invert(77%)_sepia(46%)_saturate(645%)_hue-rotate(2deg)_brightness(95%)]" />
          <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#d4af37] sm:text-xs">Gift card</p>
        </div>
        <div className="pr-[16%]">
          <p className={`font-display text-xl font-black uppercase leading-tight sm:text-3xl ${GOLD_TEXT}`}>{planName.replace(' (gift)', '')}</p>
          {(to || from) && <p className="mt-1 text-xs text-[#cdb67a] sm:text-sm">{to ? `For ${to}` : ''}{to && from ? ' · ' : ''}{from ? `from ${from}` : ''}</p>}
          {code && <p className="mt-2 font-mono text-base font-bold tracking-widest text-white sm:text-xl">{code}</p>}
        </div>
      </div>
    </div>
  );
}

/** /gift: choose a pack, who it's for and how it gets to them, then pay. */
export default function GiftShop() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const plans = useAsync(() => gifts.plans(), []);
  const [planId, setPlanId] = useState<string | null>(null);
  const [byEmail, setByEmail] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const today = localDateKey(new Date());
  const [sendOn, setSendOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idem = useMemo(() => crypto.randomUUID(), []);
  useEffect(() => { if (!planId && plans.data?.length) setPlanId((plans.data.find((p) => p.code === 'multi-8') ?? plans.data[0]).id); }, [plans.data, planId]);
  const plan = plans.data?.find((p) => p.id === planId) ?? null;

  if (plans.loading && !plans.data) return <PageSpinner />;
  if (plans.error) return <ErrorNotice error={plans.error} onRetry={plans.reload} />;

  async function buy() {
    if (!plan) return;
    if (!session) { navigate(`/login?next=${encodeURIComponent('/gift')}`); return; }
    if (byEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError(messageFor('invalid_email')); return; }
    setBusy(true); setError(null);
    try {
      const next = await checkout({ plan_id: plan.id, gift: true, idempotency_key: idem, recipient_name: name.trim() || null,
        recipient_email: byEmail ? email.trim() : null, message: message.trim() || null, send_on: byEmail ? sendOn : null });
      if ('redirect' in next) window.location.href = next.redirect; else navigate(next.navigate);
    } catch (e) { setError(messageFor((e as { code?: string }).code ?? (e as Error).message)); setBusy(false); }
  }

  return (
    <div className="bg-[#070605] text-[#f3e7c6]">
      <section className="container-page py-10 sm:py-14">
        <p className="text-xs font-bold uppercase tracking-[0.35em] text-[#d4af37]">Gift cards</p>
        <h1 className={`mt-2 font-display text-4xl font-black uppercase leading-[0.95] sm:text-6xl ${GOLD_TEXT}`}>Give the gift of dance</h1>
        <p className="mt-3 max-w-xl text-[#eadcb5]">A unique present for the ones you love who can’t stop dancing. Choose a pack, add a personal message and pick the day it arrives, or print it and give it in person.</p>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div><GiftCardVisual planName={plan?.gift_name ?? 'Drop Studios'} to={name || null} /></div>
          <div className="space-y-5">
            <fieldset>
              <legend className="text-sm font-bold uppercase tracking-wider text-[#d4af37]">1. Choose the gift</legend>
              <div className="mt-2 grid gap-2">
                {(plans.data ?? []).map((p: GiftablePlan) => (
                  <label key={p.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-3 ${planId === p.id ? 'border-[#d4af37] bg-[#d4af37]/10' : 'border-white/15'}`}>
                    <span className="flex items-center gap-3">
                      <input type="radio" name="plan" className="h-5 w-5 accent-[#d4af37]" checked={planId === p.id} onChange={() => setPlanId(p.id)} />
                      <span><span className="block font-bold text-white">{p.gift_name}</span><span className="text-sm text-[#cdb67a]">{classesLabel(p.class_count)}{p.monthly ? ' for one month' : ''}{p.style_access === 'single' ? ' · one style of their choice' : ' · any style'}{p.first_time_only ? ' · for someone new to Drop' : ''}</span></span>
                    </span>
                    <span className="font-display text-xl font-black text-white">{formatPrice(p.price_cents, p.currency)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-bold uppercase tracking-wider text-[#d4af37]">2. Who is it for?</legend>
              <input className="input text-ink" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Their name" />
              <textarea className="input min-h-24 text-ink" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Your personal message (optional), e.g. Happy birthday! Time to dance 💃" />
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-bold uppercase tracking-wider text-[#d4af37]">3. How should it get to them?</legend>
              <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-5 w-5 accent-[#d4af37]" checked={byEmail} onChange={(e) => setByEmail(e.target.checked)} />
                <span><span className="font-semibold text-white">Email it to them on a day I choose</span><span className="block text-sm text-[#cdb67a]">Perfect for birthdays. You’ll also get a printable card to give in person.</span></span></label>
              {byEmail && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Their email"><input className="input text-ink" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
                  <Field label="Send it on"><input className="input text-ink" type="date" min={today} value={sendOn} onChange={(e) => setSendOn(e.target.value)} /></Field>
                </div>
              )}
              {!byEmail && <p className="text-sm text-[#cdb67a]">You’ll get the code and a printable black-and-gold card to give them yourself. They can redeem it in the app or at reception.</p>}
            </fieldset>
            {error && <Notice tone="warn">{error}</Notice>}
            <button className="btn w-full bg-gradient-to-r from-[#a8801f] via-[#f5dc85] to-[#c9a227] text-lg font-black text-[#0b0906]" disabled={busy || !plan} onClick={() => void buy()}>
              {busy ? <Spinner className="h-5 w-5" /> : plan ? `Buy gift card · ${formatPrice(plan.price_cents, plan.currency)}` : 'Choose a gift'}
            </button>
            <p className="text-center text-xs text-[#a8946a]">Secure payment by Square (card, Apple Pay, Google Pay). Valid for 5 years. Got a gift card? <Link to="/gift/redeem" className="font-semibold text-[#f3d77e] underline">Redeem it here</Link></p>
          </div>
        </div>
      </section>
    </div>
  );
}

/** /gift/redeem: the friend enters (or arrives with) their code and gets their classes. */
export function GiftRedeem() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [info, setInfo] = useState<GiftLookup | null>(null);
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const check = async (c = code) => {
    setBusy(true); setError(null); setInfo(null);
    try { setInfo(await gifts.lookup(normaliseCode(c))); } catch (e) { setError(messageFor((e as Error).message)); } finally { setBusy(false); }
  };
  useEffect(() => { if (params.get('code')) void check(params.get('code')!); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const redeem = async () => {
    if (!info) return;
    setBusy(true); setError(null);
    try { const r = await gifts.redeem(info.code, info.style_access === 'single' ? style || null : null); setDone(r.plan_name); }
    catch (e) { setError(messageFor((e as Error).message)); } finally { setBusy(false); }
  };
  return (
    <div className="container-page max-w-lg py-12">
      {done ? (
        <div className="text-center">
          <p className="text-5xl">🎁</p>
          <h1 className="mt-3 text-3xl font-black">Your gift is ready!</h1>
          <p className="mt-2 text-ink-soft">{done.replace(' (gift)', '')} is now in your account. Time to book your first class.</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to="/timetable" className="btn-primary">Book a class</Link>
            <Link to="/account" className="btn-outline">My Membership</Link>
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-black">Redeem a gift card</h1>
          <p className="mt-2 text-ink-soft">Enter the code from your email or printed card.</p>
          <form className="mt-5 flex gap-2" onSubmit={(e) => { e.preventDefault(); void check(); }}>
            <input className="input font-mono uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="DROP-XXXX-XXXX" autoCapitalize="characters" />
            <button className="btn-primary" disabled={busy || code.trim().length < 8}>{busy && !info ? <Spinner className="h-4 w-4" /> : 'Check'}</button>
          </form>
          {error && <div className="mt-4"><Notice tone="warn">{error}</Notice></div>}
          {info && (
            <div className="mt-6 space-y-4">
              <GiftCardVisual planName={info.plan_name} code={info.code} to={info.recipient_name} small />
              {info.status === 'active' ? (
                <>
                  <p className="text-center text-sm text-ink-soft">{classesLabel(info.class_count)}, valid for {info.validity_days} days from today. Gift card valid until {fullDate(info.expires_at)}.</p>
                  {info.style_access === 'single' && (
                    <Field label="Choose your dance style">
                      <select className="input" value={style} onChange={(e) => setStyle(e.target.value)}>
                        <option value="">Choose…</option>
                        {(info.styles ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </Field>
                  )}
                  <button className="btn-primary w-full text-lg" disabled={busy || (info.style_access === 'single' && !style)} onClick={() => void redeem()}>{busy ? <Spinner className="h-5 w-5" /> : 'Redeem my gift'}</button>
                </>
              ) : <Notice tone="warn">{messageFor(info.status === 'redeemed' ? 'gift_card_used' : info.status === 'expired' ? 'gift_card_expired' : 'gift_card_not_active')}</Notice>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** /gift/card/:id: the buyer's printable card. */
export function GiftCardPrint() {
  const { id } = useParams();
  const card = useAsync(() => gifts.card(id!), [id]);
  if (card.loading) return <PageSpinner />;
  if (card.error || !card.data) return <ErrorNotice error={card.error ?? 'Gift card not found.'} />;
  const g = card.data;
  return (
    <div className="container-page max-w-2xl py-10 print:py-0">
      <div className="print:hidden">
        <h1 className="text-3xl font-black">Your gift card</h1>
        <p className="mt-1 text-ink-soft">{g.status === 'redeemed' ? `Redeemed on ${fullDate(g.redeemed_at!)}. Thank you!` : g.recipient_email ? (g.recipient_emailed_at ? `Emailed to ${g.recipient_name ?? g.recipient_email} on ${fullDate(g.recipient_emailed_at)}.` : `We’ll email it to ${g.recipient_name ?? g.recipient_email} on ${fullDate(`${g.send_on}T12:00:00Z`)}.`) : 'Print it or share the code to give it in person.'}</p>
      </div>
      <div className="mt-6 rounded-3xl bg-[#070605] p-6 print:bg-white print:p-0">
        <GiftCardVisual planName={g.plan_snapshot.plan_name} code={g.code} to={g.recipient_name} from={g.buyer?.full_name ?? null} />
        {g.message && <p className="mx-auto mt-5 max-w-xl text-center font-display text-lg italic text-[#f3e7c6] print:text-ink">“{g.message}”</p>}
        <p className="mx-auto mt-4 max-w-xl text-center text-sm text-[#cdb67a] print:text-ink-soft">Redeem at dropstudios.ie/gift/redeem or at reception · 13 Sackville Place, Dublin 1 · Valid until {g.expires_at ? fullDate(g.expires_at) : ''}</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-2 print:hidden">
        <button className="btn-primary" onClick={() => window.print()}>🖨️ Print the card</button>
        <button className="btn-outline" onClick={() => void navigator.clipboard?.writeText(g.code)}>Copy code</button>
        <Link to="/gift" className="btn-ghost">Buy another</Link>
      </div>
    </div>
  );
}
