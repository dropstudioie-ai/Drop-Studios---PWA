import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Notice, Spinner } from '../components/ui';
import { useAuth } from '../auth/AuthProvider';
import { LoyaltyRewardPopup } from '../components/LoyaltyReward';

type View = 'waiting' | 'succeeded' | 'failed' | 'timeout';

/**
 * Square redirects here after checkout. The membership is only activated once
 * the server has confirmed payment via the webhook, so we poll for that.
 */
export function CheckoutSuccess() {
  const [params] = useSearchParams();
  const paymentId = params.get('payment_id');
  const [view, setView] = useState<View>('waiting');
  const [isTest, setIsTest] = useState(false);
  const [isTicket, setIsTicket] = useState(false);
  const [isDropIn, setIsDropIn] = useState(false);
  const [reward, setReward] = useState(false);
  const { session, profile } = useAuth();
  const uid = session?.user.id;

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      attempts++;
      try {
        const p = await api.paymentStatus(paymentId);
        if (cancelled) return;
        if (p?.status === 'succeeded') {
          setIsTest(p.is_test);
          setIsTicket(p.kind === 'ticket' || p.kind === 'drop_in');
          setIsDropIn(p.kind === 'drop_in');
          setView('succeeded');
          // Back after completing 3 months? The loyalty reward is added with this payment.
          if (p.kind === 'membership' && uid) api.hasRecentReward(uid).then((r) => !cancelled && setReward(r)).catch(() => {});
          return;
        }
        if (p && ['failed', 'cancelled'].includes(p.status)) {
          setView('failed');
          return;
        }
      } catch { /* keep polling */ }
      if (attempts >= 30) setView('timeout');
      else setTimeout(tick, 2000);
    };
    void tick();
    return () => { cancelled = true; };
  }, [paymentId, uid]);

  return (
    <div className="container-page max-w-lg py-12 text-center">
      {view === 'waiting' && (
        <>
          <Spinner className="h-10 w-10 text-brand-600" />
          <h1 className="mt-4 text-2xl font-black">Confirming your payment…</h1>
          <p className="mt-2 text-ink-soft">This usually takes a few seconds.</p>
        </>
      )}
      {view === 'succeeded' && (
        <>
          <p className="text-5xl" aria-hidden="true">🎉</p>
          <h1 className="mt-4 text-3xl font-black">You’re in!</h1>
          <p className="mt-2 text-ink-soft">{isDropIn ? 'Your Drop In class is booked. It’s in your upcoming bookings.' : isTicket ? 'Your ticket is confirmed. It’s in your upcoming bookings.' : 'Your membership is ready. Time to book your first class.'}</p>
          {isTest && <div className="mt-4 text-left"><Notice tone="test"><strong>TEST purchase.</strong> No real payment was taken.</Notice></div>}
          {reward && <LoyaltyRewardPopup name={profile?.full_name?.split(' ')[0] ?? ''} onClose={() => setReward(false)} />}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Link to="/timetable" className="btn-primary">Book a class</Link>
            <Link to="/account" className="btn-outline">My Membership</Link>
          </div>
        </>
      )}
      {view === 'failed' && (
        <>
          <h1 className="text-2xl font-black">Payment not completed</h1>
          <p className="mt-2 text-ink-soft">Nothing was added and you weren’t charged.</p>
          <Link to="/memberships" className="btn-primary mt-6">Try again</Link>
        </>
      )}
      {view === 'timeout' && (
        <>
          <h1 className="text-2xl font-black">Still confirming</h1>
          <p className="mt-2 text-ink-soft">Your payment is still being confirmed. It will appear in your account as soon as it’s confirmed. You don’t need to pay again.</p>
          <Link to="/account" className="btn-primary mt-6">Go to My Membership</Link>
        </>
      )}
    </div>
  );
}

export function CheckoutCancelled() {
  return (
    <div className="container-page max-w-lg py-12 text-center">
      <h1 className="text-2xl font-black">Checkout cancelled</h1>
      <p className="mt-2 text-ink-soft">No payment was taken. Any workshop spot held for you is released automatically.</p>
      <Link to="/memberships" className="btn-primary mt-6">Back to memberships</Link>
    </div>
  );
}
