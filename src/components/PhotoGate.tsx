import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { uploadProfilePhoto } from '../lib/avatar';
import { Spinner, useToast } from './ui';

/**
 * Shown whenever a member without a profile photo tries to book or buy.
 * They can take a selfie or pick a photo right here and carry on.
 */
export function PhotoGate({ onAdded }: { onAdded?: () => void }) {
  const { session, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const selfie = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file || !session) return;
    setBusy(true);
    try {
      await uploadProfilePhoto(session.user.id, file, profile?.avatar_path ?? null);
      await refreshProfile();
      toast('Photo added. You’re ready to book!');
      onAdded?.();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (selfie.current) selfie.current.value = '';
      if (pick.current) pick.current.value = '';
    }
  }

  return (
    <div className="rounded-2xl border-2 border-accent-500 bg-accent-50 p-4" role="alert">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-500 text-2xl" aria-hidden="true">📸</span>
        <div>
          <p className="font-display text-lg font-extrabold">Add a profile photo to book</p>
          <p className="mt-0.5 text-sm text-ink-soft">
            We need a photo of you before you can book classes, so your instructor can welcome you at the door.
            Only you and studio staff can see it.
          </p>
        </div>
      </div>
      <input ref={selfie} type="file" accept="image/*" capture="user" className="sr-only" id="gate-selfie" onChange={(e) => void onFile(e.target.files?.[0])} />
      <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="gate-pick" onChange={(e) => void onFile(e.target.files?.[0])} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label htmlFor="gate-selfie" className="btn-accent btn-sm cursor-pointer" aria-disabled={busy}>{busy && <Spinner />}Take a selfie</label>
        <label htmlFor="gate-pick" className="btn-outline btn-sm cursor-pointer bg-white" aria-disabled={busy}>Choose a photo</label>
      </div>
    </div>
  );
}
