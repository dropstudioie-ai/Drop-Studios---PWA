import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { currentSubscription, needsInstallForPush, pushSupported, subscribeToPush } from '../lib/push';
import { BellIcon } from './icons';

const ASKED_KEY = 'drop.push.asked';

/**
 * Phone notifications are on by default. Browsers still need the member to
 * allow them once, so right after sign-in we offer it with one tap. If they
 * already allowed it before (e.g. a new login on the same phone), it's
 * switched on silently.
 */
export function NotificationsPrompt() {
  const { session, profile, isStaff } = useAuth();
  const uid = session?.user.id;
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || !profile || profile.notify_push === false || !pushSupported() || needsInstallForPush()) return;
    let live = true;
    void (async () => {
      const sub = await currentSubscription().catch(() => null);
      if (!live || sub) return;
      if (Notification.permission === 'granted') {
        await subscribeToPush(uid).catch(() => {});
        return;
      }
      if (Notification.permission !== 'default') return;
      try { if (sessionStorage.getItem(ASKED_KEY) === uid) return; } catch { /* storage unavailable */ }
      setShow(true);
    })();
    return () => { live = false; };
  }, [uid, profile, isStaff]);

  const later = () => {
    setShow(false);
    try { if (uid) sessionStorage.setItem(ASKED_KEY, uid); } catch { /* storage unavailable */ }
  };

  async function turnOn() {
    if (!uid) return;
    setBusy(true);
    await subscribeToPush(uid).catch(() => {});
    setBusy(false);
    later();
  }

  if (!show) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 rounded-2xl bg-brand-600 p-4 text-white shadow-xl md:bottom-6 md:left-auto md:right-6 md:max-w-sm" role="dialog" aria-labelledby="push-title">
      <div className="flex items-start gap-3">
        <BellIcon className="mt-0.5 shrink-0" />
        <div className="flex-1 text-sm">
          <p id="push-title" className="font-semibold">Turn on notifications</p>
          <p className="text-white/85">Class reminders and booking updates on your phone. You can turn them off any time in My Membership.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-sm btn bg-white text-brand-700 hover:bg-brand-50" disabled={busy} onClick={() => void turnOn()}>Turn on</button>
            <button className="btn-sm btn text-white hover:bg-white/10" onClick={later}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
