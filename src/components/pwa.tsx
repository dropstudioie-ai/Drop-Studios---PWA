import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { DownloadIcon } from './icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-ink px-4 py-2 text-center text-sm font-medium text-white" role="status">
      You’re offline. You can browse saved pages; booking needs a connection.
    </div>
  );
}

const DISMISS_KEY = 'drop.install.dismissed';

/** Android/desktop: native install prompt. iOS: Add to Home Screen hint. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos && !standalone) setIosHint(true);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
  };

  if (dismissed || (!evt && !iosHint)) return null;

  return (
    <div className="fixed inset-x-3 bottom-[5.5rem] z-40 rounded-2xl bg-ink p-4 text-white shadow-xl md:bottom-6 md:left-auto md:right-6 md:max-w-sm">
      <div className="flex items-start gap-3">
        <DownloadIcon className="mt-0.5 shrink-0 text-accent-400" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">Get the Drop Studios app</p>
          {evt ? (
            <p className="text-white/80">Install it for one-tap booking from your home screen.</p>
          ) : (
            <p className="text-white/80">Tap <strong>Share</strong> then <strong>Add to Home Screen</strong> to install.</p>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button className="btn-sm btn text-white/80 hover:bg-white/10" onClick={dismiss}>Not now</button>
        {evt && (
          <button className="btn-sm btn-accent" onClick={async () => {
            await evt.prompt();
            await evt.userChoice;
            setEvt(null);
            dismiss();
          }}>Install</button>
        )}
      </div>
    </div>
  );
}

export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-brand-700 p-3 pl-4 text-sm text-white shadow-xl">
      <span>A new version is available.</span>
      <span className="flex gap-1">
        <button className="btn-sm btn text-white/80" onClick={() => setNeedRefresh(false)}>Later</button>
        <button className="btn-sm btn-accent" onClick={() => updateServiceWorker(true)}>Update</button>
      </span>
    </div>
  );
}
