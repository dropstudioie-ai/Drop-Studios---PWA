import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { currentSubscription, needsInstallForPush, pushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { Link } from 'react-router-dom';
import { useToast } from './ui';

/** My Membership → Notifications: email and phone, both on by default. */
export function NotificationSettings() {
  const { session, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const uid = session?.user.id;
  const [deviceOn, setDeviceOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void currentSubscription().then((s) => setDeviceOn(Boolean(s))).catch(() => setDeviceOn(false)); }, []);

  if (!uid || !profile) return null;
  const emailOn = profile.notify_email !== false;
  const pushOn = profile.notify_push !== false && Boolean(deviceOn);

  async function setEmail(on: boolean) {
    setBusy(true);
    try {
      await api.updateProfile(uid!, { notify_email: on });
      await refreshProfile();
      toast(on ? 'Email reminders on.' : 'Email reminders off.');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  async function setPush(on: boolean) {
    setBusy(true);
    try {
      if (on) await subscribeToPush(uid!); else await unsubscribeFromPush();
      await api.updateProfile(uid!, { notify_push: on });
      await refreshProfile();
      setDeviceOn(on);
      toast(on ? 'Phone notifications on for this device.' : 'Phone notifications off.');
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  return (
    <section className="mt-10" aria-labelledby="notif-h">
      <h2 id="notif-h" className="text-xl font-black">Notifications</h2>
      <p className="mt-1 text-sm text-muted">Class reminders, changes to your bookings and membership updates. Everything comes by email; phone notifications are an optional extra.</p>
      <div className="card mt-3 divide-y divide-line">
        <Toggle label="Email (recommended)" hint={emailOn ? (profile.email ?? '') : 'Off: you may miss class changes and cancellations'} checked={emailOn} disabled={busy} onChange={(v) => void setEmail(v)} />
        {pushSupported() ? (
          needsInstallForPush() ? (
            <div className="p-4 text-sm">
              <p className="font-semibold">Phone notifications</p>
              <p className="text-muted">On iPhone, add the app to your Home Screen first, then switch them on here. <Link to="/app" className="font-semibold text-brand-700 underline">How?</Link></p>
            </div>
          ) : (
            <Toggle label="Phone notifications" hint="Optional extra, on this device" checked={pushOn} disabled={busy || deviceOn === null} onChange={(v) => void setPush(v)} />
          )
        ) : (
          <div className="p-4 text-sm"><p className="font-semibold">Phone notifications</p><p className="text-muted">Not available in this browser.</p></div>
        )}
      </div>
    </section>
  );
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 p-4">
      <span className="min-w-0"><span className="block font-semibold">{label}</span><span className="block truncate text-sm text-muted">{hint}</span></span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-line'} peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500`}>
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
      </span>
    </label>
  );
}
