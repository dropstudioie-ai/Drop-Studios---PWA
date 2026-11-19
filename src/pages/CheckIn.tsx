import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { checkin, type CheckInResult } from '../lib/checkin';
import { messageFor } from '../domain/messages';
import { PageSpinner } from '../components/ui';
import { Celebration } from '../components/Celebration';

/** /checkin?s=…&t=…: opened by scanning the teacher's QR code. */
export default function CheckInPage() {
  const [params] = useSearchParams();
  const [res, setRes] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const s = params.get('s'), t = params.get('t');
    if (!t || (!s && !params.get('studio'))) { setError('checkin_code_expired'); return; }
    (s ? checkin.checkIn(s, t) : checkin.checkInStudio(t)).then(setRes).catch((e) => setError((e as Error).message));
  }, [params]);

  if (error) {
    return (
      <div className="container-page max-w-md py-16 text-center">
        <p className="text-5xl">{error === 'checkin_not_booked' ? '🎟️' : '📷'}</p>
        <h1 className="mt-3 text-2xl font-black">{error === 'checkin_not_booked' ? 'You’re not booked into this class' : 'Couldn’t check you in'}</h1>
        <p className="mt-2 text-ink-soft">{messageFor(error)}</p>
        <Link to="/timetable" className="btn-primary mt-6">Open the timetable</Link>
      </div>
    );
  }
  if (!res) return <PageSpinner />;
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
