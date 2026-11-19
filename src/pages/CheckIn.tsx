import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkin, type CheckInFailed, type CheckInResult, type DoorOption } from '../lib/checkin';
import { checkout } from '../lib/payments';
import { formatPrice } from '../domain/money';
import { fmt } from '../domain/time';
import { messageFor } from '../domain/messages';
import { PageSpinner, Spinner } from '../components/ui';
import { Celebration } from '../components/Celebration';

/** /checkin?s=…&t=… (teacher's code) or /checkin?studio=1&t=… (reception code): opened by scanning the QR. */
export default function CheckInPage() {
  const [params] = useSearchParams();
  const sessionId = params.get('s');
  const code = params.get('t') ?? '';
  const studio = !sessionId && params.get('studio') === '1';
  const [res, setRes] = useState<CheckInResult | null>(null);
  const [failed, setFailed] = useState<CheckInFailed | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!code || (!sessionId && !studio)) { setError('checkin_code_expired'); return; }
    (sessionId ? checkin.checkIn(sessionId, code) : checkin.checkInStudio(code))
      .then((r) => (r.ok ? setRes(r) : setFailed(r)))
      .catch((e) => setError((e as Error).message));
  }, [sessionId, code, studio]);

  if (res) return <Welcome res={res} />;
  if (failed?.reason === 'checkin_not_booked') return <NotBooked options={failed.options} code={code} studio={studio} onDone={setRes} />;
  if (failed || error) {
    const reason = failed?.reason ?? error!;
    return (
      <div className="container-page max-w-md py-16 text-center">
        <p className="text-5xl">📷</p>
        <h1 className="mt-3 text-2xl font-black">Couldn’t check you in</h1>
        <p className="mt-2 text-ink-soft">{messageFor(reason)}</p>
        <p className="mt-2 text-sm text-muted">Your teacher has been told, so they can help.</p>
        <Link to="/timetable" className="btn-primary mt-6">Open the timetable</Link>
      </div>
    );
  }
  return <PageSpinner />;
}

/** Not booked: book with your membership and check in in one tap, or pay for a Drop In. */
function NotBooked({ options, code, studio, onDone }: { options: DoorOption[]; code: string; studio: boolean; onDone: (r: CheckInResult) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const idem = useMemo(() => crypto.randomUUID(), []);
  const open = options.filter((o) => o.spots_left > 0);
  async function book(o: DoorOption) {
    setBusy(o.session_id); setError(null);
    try { onDone(await checkin.bookAndCheckIn(o.session_id, code, studio)); }
    catch (e) { setError(messageFor((e as Error).message)); setBusy(null); }
  }
  async function pay(o: DoorOption) {
    setBusy(o.session_id); setError(null);
    try {
      const next = await checkout({ session_id: o.session_id, idempotency_key: idem });
      if ('redirect' in next) window.location.href = next.redirect; else window.location.href = next.navigate;
    } catch (e) { setError(messageFor((e as { code?: string }).code ?? (e as Error).message)); setBusy(null); }
  }
  return (
    <div className="container-page max-w-md py-12 text-center">
      <p className="text-5xl">🎟️</p>
      <h1 className="mt-3 text-2xl font-black">You’re not booked in yet</h1>
      {open.length ? (
        <>
          <p className="mt-2 text-ink-soft">No problem, there’s space. Book now and you’re checked in straight away.</p>
          <ul className="mt-6 space-y-3 text-left">
            {open.map((o) => (
              <li key={o.session_id} className="card p-4">
                <p className="font-bold">{o.title}</p>
                <p className="text-sm text-muted">{fmt.time(o.starts_at)} · {o.spots_left} {o.spots_left === 1 ? 'spot' : 'spots'} left</p>
                {o.membership ? (
                  <button className="btn-primary mt-3 w-full" disabled={busy !== null} onClick={() => void book(o)}>
                    {busy === o.session_id ? <Spinner /> : `Book & check in · uses 1 class from ${o.membership}`}
                  </button>
                ) : o.drop_in_price_cents != null || o.is_special ? (
                  <>
                    <button className="btn-accent mt-3 w-full" disabled={busy !== null} onClick={() => void pay(o)}>
                      {busy === o.session_id ? <Spinner /> : o.is_special ? 'Buy a ticket' : `Pay Drop In · ${formatPrice(o.drop_in_price_cents ?? 0, 'EUR')}`}
                    </button>
                    <p className="mt-2 text-xs text-muted">After paying, scan the code again to check in.</p>
                  </>
                ) : <p className="mt-2 text-sm text-muted">Please talk to your teacher.</p>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-2 text-ink-soft">{options.length ? 'This class is full right now.' : 'There’s no class you can book right now.'} Please talk to your teacher, they’ve been told you’re here.</p>
      )}
      {error && <p className="mt-4 text-sm font-semibold text-danger">{error}</p>}
    </div>
  );
}

function Welcome({ res }: { res: CheckInResult }) {
  const name = res.first_name || 'there';
  return (
    <div className={`min-h-[80vh] ${res.birthday ? 'bg-gradient-to-b from-accent-100 to-white' : ''}`}>
      {res.birthday ? <Celebration emojis={['🎂', '🎉', '🎈', '✨', '🥳']} count={60} /> : res.first_class ? <Celebration emojis={['💃', '🕺', '✨', '🎉']} count={35} /> : null}
      <div className="container-page max-w-md py-16 text-center">
        {res.birthday ? (
          <>
            <p className="text-7xl">🎂</p>
            <h1 className="mt-4 font-display text-4xl font-black">Happy birthday, {name}!</h1>
            <p className="mt-2 text-lg text-ink-soft">{res.turning ? `${res.turning} looks good on you. ` : ''}Thank you for spending part of your day dancing with us. 💛</p>
          </>
        ) : res.first_class ? (
          <>
            <p className="text-7xl">💃</p>
            <h1 className="mt-4 font-display text-4xl font-black">Welcome to Drop, {name}!</h1>
            <p className="mt-2 text-lg text-ink-soft">Your first class starts now. Relax, have fun, and don’t worry about getting every step. Your teacher knows you’re new. ✨</p>
          </>
        ) : (
          <>
            <p className="text-7xl">✅</p>
            <h1 className="mt-4 font-display text-4xl font-black">{res.already ? 'Already checked in' : `You’re in, ${name}!`}</h1>
            <p className="mt-2 text-lg text-ink-soft">Enjoy {res.title}. 🔥</p>
          </>
        )}
        <p className="mt-6 text-sm font-semibold text-success">✓ Checked in to {res.title}</p>
      </div>
    </div>
  );
}
