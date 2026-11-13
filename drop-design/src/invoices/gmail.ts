// Send from the owner's Gmail with Google's official sign-in (only the "send email" permission).
// Needs a Google OAuth client ID (Web application) whose authorised origin is where this app runs.
import { GOOGLE_CLIENT_ID } from '../config';
import { googleClientId } from './store';

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient: (o: { client_id: string; scope: string; callback: (r: { access_token?: string; error?: string }) => void; error_callback?: (e: { message?: string }) => void }) => { requestAccessToken: (o?: { prompt?: string }) => void } } } } }
}

export async function gmailClientId() { return (await googleClientId.get()) || GOOGLE_CLIENT_ID; }

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res(); s.onerror = () => rej(new Error('Couldn’t reach Google sign-in. Check your connection.'));
    document.head.appendChild(s);
  });
}

let token: { value: string; expires: number } | null = null;
async function getToken(clientId: string): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  await loadGis();
  return new Promise((res, rej) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: 'https://www.googleapis.com/auth/gmail.send',
      callback: (r) => { if (r.access_token) { token = { value: r.access_token, expires: Date.now() + 3500_000 }; res(r.access_token); } else rej(new Error(r.error ?? 'Google sign-in was cancelled.')); },
      error_callback: (e) => rej(new Error(e.message ?? 'Google sign-in was cancelled.')),
    });
    client.requestAccessToken({ prompt: token ? '' : 'consent' });
  });
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const blobB64 = async (b: Blob) => { const buf = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };

export async function sendWithGmail(o: { to: string; subject: string; body: string; pdf: Blob; filename: string }) {
  const clientId = await gmailClientId();
  if (!clientId) throw new Error('Gmail sending isn’t set up yet. Add your Google client ID in Invoice settings.');
  const access = await getToken(clientId);
  const boundary = `dd-${Date.now()}`;
  const mime = [
    `To: ${o.to}`, `Subject: =?UTF-8?B?${b64(o.subject)}?=`, 'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(o.body), '',
    `--${boundary}`, `Content-Type: application/pdf; name="${o.filename}"`, `Content-Disposition: attachment; filename="${o.filename}"`, 'Content-Transfer-Encoding: base64', '',
    (await blobB64(o.pdf)).replace(/.{76}/g, '$&\r\n'), `--${boundary}--`,
  ].join('\r\n');
  const raw = b64(mime).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw }),
  });
  if (!res.ok) { if (res.status === 401) token = null; throw new Error(`Gmail refused the message (${res.status}). ${(await res.text()).slice(0, 160)}`); }
}

/** Fallback without Google setup: opens a Gmail draft (the PDF is downloaded to attach). */
export function gmailComposeUrl(to: string, subject: string, body: string) {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
