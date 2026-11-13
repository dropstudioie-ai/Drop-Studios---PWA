import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { currentSubscription, needsInstallForPush, pushSupported, subscribeToPush } from '../lib/push';
import { BellIcon } from './icons';
import { isStandalone } from './pwa';

const ASKED_KEY = 'drop.push.asked';

/**
 * Email is the main channel: every reminder and update goes by email.
 * Phone notifications are a bonus, offered only inside the installed app
 * (where they actually work, including on iPhone). If the member allowed
 * them before (e.g. a new login on the same phone), they're switched on
 * silently.
 */
export function NotificationsPrompt() {
  const { session, profile, isStaff } = useAuth();
  const uid = session?.user.id;
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid || !profile || profile.notify_push === false || !pushSupported() || needsInstallForPush()) return;
    const offer = isStandalone();
    let live = true;
    void (async () => {
      const sub = await currentSubscription().catch(() => null);
      if (!live || sub) return;
      if (Notification.permission === 'granted') {
        await subscribeToPush(uid).catch(() => {});
        return;
      }
      if (Notification.permission !== 'default' || !offer) return;
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
          <p id="push-title" className="font-semibold">Phone notifications too?</p>
          <p className="text-white/85">We already email you reminders and booking updates. Turn this on to get them as phone notifications too. Change it any time in My Membership.</p>
          <div className="mt-3 flex gap-2">
            <button className="btn-sm btn bg-white text-brand-700 hover:bg-brand-50" disabled={busy} onClick={() => void turnOn()}>Turn on</button>
            <button className="btn-sm btn text-white hover:bg-white/10" onClick={later}>Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}
