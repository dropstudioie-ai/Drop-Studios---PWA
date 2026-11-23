import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { api, unwrap } from '../api';
import type { Membership, PauseAllowance } from '../api/types';
import { formatKey, localDateKey } from '../domain/time';
import { PauseSheet } from './PauseSheet';

interface Nudge { id: string; kind: 'schedule_pause'; pause_from: string; note: string | null; membership_id: string; classes_remaining: number; expires_at: string }
const LATER = 'drop.nudge.later';
const QUIET = ['/checkin', '/checkout'];

/** The studio asked this member to schedule a pause from a date: ask every visit until it's done. */
export function PauseNudge() {
  const { session, isStaff } = useAuth();
  const uid = session?.user.id;
  const { pathname } = useLocation();
  const [n, setN] = useState<Nudge | null>(null);
  const [m, setM] = useState<Membership | null>(null);
  const [allowance, setAllowance] = useState<PauseAllowance | null>(null);
  const [step, setStep] = useState<'ask' | 'sheet' | 'done' | null>(null);

  useEffect(() => {
    if (!uid || isStaff) return;
    try { if (sessionStorage.getItem(LATER) === '1') return; } catch { /* storage unavailable */ }
    let live = true;
    (async () => {
      const r = unwrap(await supabase.rpc('my_nudge')) as Nudge | null;
      if (!live || !r) return;
      const [ms, al] = await Promise.all([api.myMemberships(uid), api.pauseAllowance().catch(() => null)]);
      if (!live) return;
      setM(ms.find((x) => x.id === r.membership_id) ?? null); setAllowance(al); setN(r); setStep('ask');
    })().catch(() => {});
    return () => { live = false; };
  }, [uid, isStaff]);

  const later = () => { setStep(null); try { sessionStorage.setItem(LATER, '1'); } catch { /* storage unavailable */ } };
  if (!n || !m || !step || QUIET.some((p) => pathname.startsWith(p))) return null;
  const from = formatKey(n.pause_from, { weekday: 'long', day: 'numeric', month: 'long' });
  const lastClassDay = formatKey(localDateKey(new Date(new Date(`${n.pause_from}T12:00:00Z`).getTime() - 864e5)), { weekday: 'long', day: 'numeric', month: 'long' });

  if (step === 'sheet') {
    return <PauseSheet membership={m} allowance={allowance} minStart={n.pause_from} initialStart={n.pause_from} onClose={() => setStep('ask')} onDone={() => setStep('done')} />;
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="nd-h">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {step === 'ask' ? (
          <>
            <p className="text-4xl">⏸️</p>
            <h2 id="nd-h" className="mt-2 text-2xl font-black">Schedule your pause</h2>
            <p className="mt-2 text-ink-soft">
              Your classes from the old app are here: <strong>{n.classes_remaining} {n.classes_remaining === 1 ? 'class' : 'classes'}</strong>, for any class.
              As we agreed, please schedule your pause so you don’t lose them while you’re away.
            </p>
            <p className="mt-3 rounded-xl bg-accent-50 p-3 text-sm text-ink">
              Your pause starts from <strong>{from}</strong>, so you can still come to class until {lastClassDay}. While paused, classes can’t be booked.
            </p>
            {n.note && <p className="mt-3 text-sm text-ink-soft">“{n.note}”</p>}
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn-accent text-lg" onClick={() => setStep('sheet')}>Choose my dates</button>
              <button className="btn-outline" onClick={later}>Later</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-4xl">✅</p>
            <h2 id="nd-h" className="mt-2 text-2xl font-black">Pause scheduled</h2>
            <p className="mt-2 text-ink-soft">Thank you! Your end date has moved back by the days you’re away. Enjoy your break 💛</p>
            <button className="btn-primary mt-5 w-full" onClick={() => setStep(null)}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
