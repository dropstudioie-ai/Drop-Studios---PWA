import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/** /scan: scan the check-in QR from inside the app (already logged in), instead of the phone camera opening the browser. */
export default function ScanPage() {
  const video = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stop = false;
    let detector: { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> } | null = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;

    const handle = (text: string) => {
      try {
        const u = new URL(text);
        if (u.origin === window.location.origin && u.pathname === '/checkin') { stop = true; navigate(u.pathname + u.search, { replace: true }); return true; }
      } catch { /* not a URL */ }
      setError('That’s not a Drop check-in code. Point at the QR on the teacher’s phone or the reception screen.');
      return false;
    };

    async function tick() {
      if (stop || !video.current || video.current.readyState < 2) { if (!stop) requestAnimationFrame(() => void tick()); return; }
      const v = video.current;
      try {
        if (detector) {
          const codes = await detector.detect(v);
          if (codes[0] && handle(codes[0].rawValue)) return;
        } else if (jsQR && ctx) {
          canvas.width = v.videoWidth; canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height);
          if (code && handle(code.data)) return;
        }
      } catch { /* try the next frame */ }
      if (!stop) setTimeout(() => requestAnimationFrame(() => void tick()), 150);
    }

    (async () => {
      try {
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => typeof detector }).BarcodeDetector;
        if (BD) detector = new BD({ formats: ['qr_code'] });
        else jsQR = (await import('jsqr')).default as unknown as typeof jsQR;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stop) return;
        video.current!.srcObject = stream;
        await video.current!.play();
        void tick();
      } catch {
        setError('We couldn’t open the camera. Allow camera access for the Drop app in your phone’s settings, or use your phone camera to scan.');
      }
    })();
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-ink text-white">
      <div className="flex items-center justify-between p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Link to="/" className="rounded-full bg-white/15 px-4 py-2 font-semibold">← Back</Link>
        <p className="font-bold">Scan to check in</p>
      </div>
      <div className="relative mx-4 flex-1 overflow-hidden rounded-3xl bg-black">
        <video ref={video} playsInline muted className="h-full w-full object-cover" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-64 w-64 rounded-3xl border-4 border-accent-500 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
      </div>
      <p className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-white/85">{error ?? 'Point at the QR code on the teacher’s phone or the reception screen.'}</p>
    </div>
  );
}
