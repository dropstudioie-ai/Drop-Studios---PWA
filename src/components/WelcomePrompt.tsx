import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { unwrap } from '../api';
import { uploadProfilePhoto } from '../lib/avatar';
import type { MySurvey } from '../lib/survey';
import { SurveyDialog } from './SurveyPrompt';
import { Spinner, useToast } from './ui';

interface Welcome { plan_name: string; classes: number; unlimited: boolean; expires_at: string; has_photo: boolean; survey: MySurvey | null; rated: boolean }
export const WELCOME_PENDING = 'drop.welcome.pending';
const LATER = 'drop.welcome.later';
const QUIET = ['/checkin', '/checkout'];

/** Members moved from the old app: a short checklist (photo, survey, rate the new app) each visit until it's done. */
export function WelcomePrompt() {
  const { session, isStaff, refreshProfile } = useAuth();
  const uid = session?.user.id;
  const { pathname } = useLocation();
  const toast = useToast();
  const [w, setW] = useState<Welcome | null>(null);
  const [open, setOpen] = useState(false);
  const [surveying, setSurveying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = unwrap(await supabase.rpc('my_welcome')) as Welcome | null;
    setW(r);
    return r;
  };
  useEffect(() => {
    if (!uid || isStaff) return;
    try { if (sessionStorage.getItem(LATER) === '1') return; } catch { /* storage unavailable */ }
    let live = true;
    load().then((r) => {
      if (!live || !r) return;
      try { sessionStorage.setItem(WELCOME_PENDING, '1'); } catch { /* storage unavailable */ }   // the survey is asked here, not separately
      setOpen(true);
    }).catch(() => {});
    return () => { live = false; };
  }, [uid, isStaff]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !w || QUIET.some((p) => pathname.startsWith(p))) return null;
  if (surveying && w.survey) {
    return <SurveyDialog survey={w.survey} userId={uid!} onClose={() => { setSurveying(false); void load(); }} />;
  }
  const allDone = w.has_photo && !w.survey && w.rated;
  const close = async (done: boolean) => {
    if (done) await supabase.rpc('welcome_done').then(() => {}, () => {});
    else try { sessionStorage.setItem(LATER, '1'); } catch { /* storage unavailable */ }
    setOpen(false);
  };
  async function photo(f: File | undefined) {
    if (!f || !uid) return;
    setBusy(true);
    try { await uploadProfilePhoto(uid, f, null); await refreshProfile(); await load(); toast('Photo added 📸'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function rate() {
    setBusy(true);
    try { unwrap(await supabase.rpc('submit_app_feedback', { p_rating: stars, p_comment: comment || null })); await load(); toast('Thank you for your feedback! 💛'); }
    catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  const until = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', day: 'numeric', month: 'long' }).format(new Date(new Date(w.expires_at).getTime() - 1));
  const Step = ({ done, n, title, children }: { done: boolean; n: number; title: string; children?: React.ReactNode }) => (
    <li className={`rounded-2xl border-2 p-3 ${done ? 'border-success/40 bg-[#dff5ea]' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-black text-white ${done ? 'bg-success' : 'bg-brand-600'}`}>{done ? '✓' : n}</span>
        <span className="flex-1 font-bold">{title}</span>
      </div>
      {!done && children && <div className="mt-2 pl-11">{children}</div>}
    </li>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/60 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="wl-h">
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-4xl">💛</p>
        <h2 id="wl-h" className="mt-2 text-2xl font-black">Welcome to the new Drop app!</h2>
        <p className="mt-2 text-ink-soft">Your membership is here: <strong>{w.unlimited ? 'unlimited classes' : `${w.classes} ${w.classes === 1 ? 'class' : 'classes'}`}</strong>, for any class, until <strong>{until}</strong>. Three quick things, please:</p>
        <ol className="mt-4 space-y-2">
          <Step done={w.has_photo} n={1} title="📸 Add your profile photo">
            <p className="text-sm text-ink-soft">So we can welcome you at the door. You need it to book.</p>
            <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => void photo(e.target.files?.[0])} />
            <button className="btn-accent btn-sm mt-2" disabled={busy} onClick={() => file.current?.click()}>{busy ? <Spinner className="h-4 w-4" /> : 'Add photo'}</button>
          </Step>
          <Step done={!w.survey} n={2} title="🎄 10-second December survey">
            <button className="btn-primary btn-sm" onClick={() => setSurveying(true)}>Answer now</button>
          </Step>
          <Step done={w.rated} n={3} title="⭐ What do you think of the new app?">
            <div className="flex gap-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${n} stars`} className={`text-3xl ${n <= stars ? '' : 'opacity-30 grayscale'}`} onClick={() => setStars(n)}>⭐</button>)}
            </div>
            <textarea className="input mt-2 min-h-16 py-2 text-sm" maxLength={2000} placeholder="Anything we could make better? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
            <button className="btn-primary btn-sm mt-2" disabled={busy || !stars} onClick={() => void rate()}>Send</button>
          </Step>
        </ol>
        <div className="mt-5 flex flex-col gap-2">
          {allDone
            ? <button className="btn-accent text-lg" onClick={() => void close(true)}>All done, let’s dance 💃</button>
            : <button className="btn-outline" onClick={() => void close(false)}>Later</button>}
        </div>
      </div>
    </div>
  );
}
