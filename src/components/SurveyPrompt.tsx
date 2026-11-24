import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { api } from '../api';
import type { Membership, PauseAllowance } from '../api/types';
import { survey, type MySurvey, type SurveyAnswer } from '../lib/survey';
import { range } from '../lib/holidays';
import { messageFor } from '../domain/messages';
import { localDateKey } from '../domain/time';
import { PauseSheet } from './PauseSheet';
import { Field, Spinner } from './ui';

const LATER = (key: string) => `drop.survey.later.${key}`;
// Never interrupt someone at the door, paying, or on a page that has its own job to do.
const QUIET = ['/checkin', '/checkout', '/feedback', '/login', '/register', '/reset-password', '/forgot-password'];

type Step = 'intro' | 'question' | 'dates' | 'pause' | 'thanks';

/** "December plans": a 10-second survey shown when members open the app (asked at most twice). */
export function SurveyPrompt() {
  const { session, isStaff } = useAuth();
  const uid = session?.user.id;
  const { pathname } = useLocation();
  const [s, setS] = useState<MySurvey | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!uid || isStaff) { setS(null); return; }
    let live = true;
    const t = setTimeout(() => {
      survey.mine().then((r) => {
        if (!live || !r) return;
        try { if (sessionStorage.getItem(LATER(r.key)) === '1' || sessionStorage.getItem('drop.welcome.pending') === '1') return; } catch { /* storage unavailable */ }
        setS(r);
      }).catch(() => {});
    }, 1200);
    return () => { live = false; clearTimeout(t); };
  }, [uid, isStaff]);

  if (!s || hidden || QUIET.some((p) => pathname.startsWith(p))) return null;
  return <SurveyDialog survey={s} userId={uid!} onClose={() => setHidden(true)} />;
}

export function SurveyDialog({ survey: sv, userId, onClose, preview = false }: { survey: MySurvey; userId: string; onClose: () => void; preview?: boolean }) {
  const year = sv.key.match(/\d{4}/)?.[0] ?? String(new Date().getFullYear());
  const monthStart = `${year}-12-01`;
  const monthEnd = `${year}-12-31`;
  const today = localDateKey(new Date());
  const [step, setStep] = useState<Step>('intro');
  const [from, setFrom] = useState(`${year}-12-19`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [away, setAway] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [allowance, setAllowance] = useState<PauseAllowance | null>(null);
  const [pausing, setPausing] = useState(false);
  const [paused, setPaused] = useState(false);

  async function notNow() {
    if (!preview) {
      survey.decline(sv.key).catch(() => {});
      try { sessionStorage.setItem(LATER(sv.key), '1'); } catch { /* storage unavailable */ }
    }
    onClose();
  }

  async function save(answer: SurveyAnswer, dates?: { from: string; to: string }) {
    setBusy(true); setError(null);
    try {
      if (!preview) await survey.answer(sv.key, answer, dates?.from, dates?.to);
      if (answer === 'some_days' || answer === 'away_all') {
        const d = dates ?? { from: monthStart, to: monthEnd };
        setAway(d);
        // Offer to schedule the pause straight away when they have classes that can be paused.
        const [ms, al] = preview ? [[], null] : await Promise.all([api.myMemberships(userId), api.pauseAllowance().catch(() => null)]);
        const m = ms.find((x) => x.state === 'active' && x.classes_remaining > 0) ?? null;
        setMembership(m); setAllowance(al);
        setStep(m || preview ? 'pause' : 'thanks');
      } else setStep('thanks');
    } catch (e) {
      setError(messageFor((e as Error).message));
    } finally { setBusy(false); }
  }

  if (pausing && membership && away) {
    return (
      <PauseSheet membership={membership} allowance={allowance} initialStart={away.from < today ? today : away.from} initialEnd={away.to}
        initialReason="Away in December" onClose={() => setPausing(false)} onDone={() => { setPaused(true); setPausing(false); setStep('thanks'); }} />
    );
  }

  const option = (emoji: string, label: string, onClick: () => void) => (
    <button className="flex w-full items-center gap-3 rounded-xl border border-line px-4 py-3 text-left font-semibold transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50" disabled={busy} onClick={onClick}>
      <span className="text-2xl">{emoji}</span><span>{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="sv-h">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        {step === 'intro' && (
          <>
            <p className="text-4xl">🎄</p>
            <h2 id="sv-h" className="mt-2 text-2xl font-black">Got 10 seconds?</h2>
            <p className="mt-2 text-ink-soft">We’re planning December’s timetable and would love to know your plans. It’s one quick question.</p>
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn-accent text-lg" onClick={() => setStep('question')}>Sure, ask me</button>
              <button className="btn-outline" onClick={() => void notNow()}>Not now</button>
            </div>
          </>
        )}

        {step === 'question' && (
          <>
            <p className="text-xs font-bold uppercase tracking-wide text-brand-700">December plans</p>
            <h2 id="sv-h" className="mt-1 text-2xl font-black">Will you be dancing with us in December?</h2>
            <div className="mt-5 space-y-2">
              {option('💃', 'Yes, I’ll keep dancing all month', () => void save('all_month'))}
              {option('✈️', 'Yes, but I’ll be away for some days', () => setStep('dates'))}
              {option('🎄', 'I’ll take December off', () => void save('away_all'))}
              {option('🤔', 'Not sure yet', () => void save('not_sure'))}
            </div>
            {busy && <div className="mt-3 flex justify-center"><Spinner /></div>}
            {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
          </>
        )}

        {step === 'dates' && (
          <>
            <p className="text-4xl">✈️</p>
            <h2 id="sv-h" className="mt-2 text-2xl font-black">When will you be away?</h2>
            <p className="mt-1 text-ink-soft">Roughly is fine.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Field label="First day away"><input className="input" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
              <Field label="Last day away"><input className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn-accent text-lg" disabled={busy || !from || !to || to < from} onClick={() => void save('some_days', { from, to })}>{busy ? <Spinner /> : 'Send'}</button>
              <button className="btn-ghost" onClick={() => setStep('question')}>Back</button>
            </div>
          </>
        )}

        {step === 'pause' && away && (
          <>
            <p className="text-4xl">⏸️</p>
            <h2 id="sv-h" className="mt-2 text-2xl font-black">Pause your membership while you’re away?</h2>
            <p className="mt-2 text-ink-soft">
              Pause it for <strong>{range(away.from, away.to)}</strong> and you won’t lose anything: your end date moves back by the days you’re away.
            </p>
            <div className="mt-5 flex flex-col gap-2">
              <button className="btn-accent text-lg" onClick={() => (preview ? setStep('thanks') : setPausing(true))}>Schedule my pause</button>
              <button className="btn-outline" onClick={() => setStep('thanks')}>No thanks</button>
            </div>
          </>
        )}

        {step === 'thanks' && (
          <>
            <p className="text-4xl">💛</p>
            <h2 id="sv-h" className="mt-2 text-2xl font-black">Thank you!</h2>
            <p className="mt-2 text-ink-soft">
              {paused ? 'Your pause is scheduled. ' : ''}This helps us plan December’s classes. We’ll let you know about any timetable changes.
            </p>
            <button className="btn-primary mt-5 w-full" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
