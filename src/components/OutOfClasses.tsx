import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { STUDIO } from '../config/studio';
import { formatKey } from '../domain/time';
import { outOfClasses, type OutOfClasses } from '../domain/subscription';

const SEEN_KEY = 'drop.outOfClasses.seen';

function Content({ out, onDone }: { out: OutOfClasses; onDone?: () => void }) {
  const sub = out.kind === 'subscription' ? out : null;
  const p = sub?.sub.plan_snapshot;
  return (
    <>
      <p className="text-4xl" aria-hidden="true">💃</p>
      <h2 className="mt-2 font-display text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">
        {sub ? 'You’ve used all your classes this month' : 'You’ve run out of classes'}
      </h2>
      <p className="mt-3 text-lg text-white/90">
        {!sub && 'Renew your membership or upgrade to a new plan to keep dancing.'}
        {sub && !sub.pastDue && <>Your next {p!.class_count} classes arrive on <strong>{formatKey(sub.nextBilling, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>. Can’t wait? Book a Drop In, or upgrade your plan.</>}
        {sub?.pastDue && <>Your last monthly payment didn’t go through. Pay the invoice Square emailed you and your classes are added straight away.</>}
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        {sub ? (
          <a className="btn bg-white text-brand-700 hover:bg-brand-50" onClick={onDone}
            href={`mailto:${STUDIO.email}?subject=${encodeURIComponent(`Upgrade my ${p!.plan_name} membership`)}`}>Upgrade my plan</a>
        ) : (
          <Link to="/memberships" className="btn bg-white text-brand-700 hover:bg-brand-50" onClick={onDone}>Renew or upgrade</Link>
        )}
        <Link to="/timetable" className="btn border-2 border-white/70 text-white hover:bg-white/10" onClick={onDone}>Book a Drop In</Link>
      </div>
    </>
  );
}

const frame = 'bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 text-white';

/** Inline version for My Membership. */
export function OutOfClassesCard({ out }: { out: OutOfClasses }) {
  return <div className={`rounded-3xl p-6 shadow-xl sm:p-8 ${frame}`} role="status"><Content out={out} /></div>;
}

/**
 * Shown each time a member opens the app with no classes left (once per app
 * session, so it doesn't follow them from page to page).
 */
export function OutOfClassesPrompt() {
  const { session, isStaff } = useAuth();
  const { pathname } = useLocation();
  const [out, setOut] = useState<OutOfClasses | null>(null);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid || isStaff) return;
    try { if (sessionStorage.getItem(SEEN_KEY) === uid) return; } catch { /* storage unavailable */ }
    let live = true;
    Promise.all([api.myMemberships(uid), api.mySubscriptions(uid)])
      .then(([ms, subs]) => live && setOut(outOfClasses(ms, subs)))
      .catch(() => {});
    return () => { live = false; };
  }, [uid, isStaff]);

  const close = () => {
    setOut(null);
    try { if (uid) sessionStorage.setItem(SEEN_KEY, uid); } catch { /* storage unavailable */ }
  };

  if (!out || pathname.startsWith('/checkout') || pathname === '/memberships') return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ooc-title" onClick={close}>
      <div className={`relative w-full max-w-lg rounded-3xl p-6 shadow-2xl sm:p-8 ${frame}`} onClick={(e) => e.stopPropagation()}>
        <button className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10" aria-label="Close" onClick={close}>✕</button>
        <div id="ooc-title"><Content out={out} onDone={close} /></div>
      </div>
    </div>
  );
}
