import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { isStandalone, useInstallEvent } from '../components/pwa';
import { Notice, useToast } from '../components/ui';

/**
 * "Get the app": Drop Studios is a web app (PWA), so it installs from the
 * browser. This page is the link to share (and the QR code to print).
 */
export default function GetApp() {
  const toast = useToast();
  const evt = useInstallEvent();
  const link = `${window.location.origin}/app`;
  const [qr, setQr] = useState<string | null>(null);
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const inApp = /instagram|fban|fbav|whatsapp|tiktok/i.test(ua);
  const installed = isStandalone();

  useEffect(() => {
    QRCode.toString(link, { type: 'svg', margin: 1, color: { dark: '#0B1020', light: '#FFFFFF' } })
      .then(setQr).catch(() => setQr(null));
  }, [link]);

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'Drop Studios app', text: 'Book classes at Drop Studios', url: link });
      else { await navigator.clipboard.writeText(link); toast('Link copied.'); }
    } catch { /* cancelled */ }
  }

  return (
    <div className="container-page max-w-2xl py-8">
      <div className="flex items-center gap-4">
        <img src="/brand/drop-icon.svg" alt="" className="h-16 w-16 rounded-2xl shadow-md" />
        <div>
          <h1 className="text-3xl font-black">Get the app</h1>
          <p className="text-ink-soft">Free · no app store needed · book classes in one tap</p>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {installed ? (
          <Notice tone="success"><strong>You’re using the app.</strong> It’s on your home screen. 🎉</Notice>
        ) : evt ? (
          <button className="btn-accent w-full text-lg" onClick={async () => { await evt.prompt(); await evt.userChoice; }}>Install the app</button>
        ) : null}

        {inApp && !installed && (
          <Notice tone="warn">You opened this link inside another app. Open it in <strong>{isIos ? 'Safari' : 'Chrome'}</strong> first (⋯ menu → “Open in browser”), then follow the steps below.</Notice>
        )}

        {!installed && (
          <>
            <section className={`card p-5 ${isAndroid ? 'opacity-60' : ''}`} aria-labelledby="ios-h">
              <h2 id="ios-h" className="text-lg font-extrabold">iPhone</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-soft">
                <li>Open this page in <strong className="text-ink">Safari</strong>.</li>
                <li>Tap the <strong className="text-ink">Share</strong> button (the square with an arrow ⬆︎).</li>
                <li>Scroll down and tap <strong className="text-ink">Add to Home Screen</strong>.</li>
                <li>Tap <strong className="text-ink">Add</strong>. The DROP icon appears on your home screen.</li>
              </ol>
            </section>

            <section className={`card p-5 ${isIos ? 'opacity-60' : ''}`} aria-labelledby="android-h">
              <h2 id="android-h" className="text-lg font-extrabold">Android</h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-soft">
                <li>Open this page in <strong className="text-ink">Chrome</strong>.</li>
                <li>Tap <strong className="text-ink">Install the app</strong> above, or the <strong className="text-ink">⋮</strong> menu → <strong className="text-ink">Install app</strong> (or “Add to Home screen”).</li>
                <li>Tap <strong className="text-ink">Install</strong>.</li>
              </ol>
            </section>
          </>
        )}

        <section className="card flex flex-col items-center gap-4 p-5 text-center sm:flex-row sm:text-left" aria-labelledby="share-h">
          {qr && <div className="h-40 w-40 shrink-0 rounded-xl border border-line p-1" role="img" aria-label="QR code for the app link" dangerouslySetInnerHTML={{ __html: qr }} />}
          <div className="min-w-0">
            <h2 id="share-h" className="text-lg font-extrabold">Share the app</h2>
            <p className="mt-1 text-sm text-ink-soft">Scan the code with a phone camera, or send the link.</p>
            <p className="mt-2 break-all font-semibold text-brand-700">{link}</p>
            <button className="btn-outline btn-sm mt-3" onClick={() => void share()}>Share link</button>
          </div>
        </section>
      </div>
    </div>
  );
}
