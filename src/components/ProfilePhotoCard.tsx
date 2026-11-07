import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { uploadProfilePhoto } from '../lib/avatar';
import { Avatar } from './Avatar';
import { Spinner, useToast } from './ui';

/** Upload or change the customer's profile photo (required for booking). */
export function ProfilePhotoCard() {
  const { session, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const missing = !profile?.avatar_path;

  async function onFile(file: File | undefined) {
    if (!file || !session) return;
    setBusy(true);
    try {
      await uploadProfilePhoto(session.user.id, file, profile?.avatar_path ?? null);
      await refreshProfile();
      toast(missing ? 'Photo added. You’re ready to book!' : 'Photo updated.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <section id="photo" aria-labelledby="photo-h"
      className={`card flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap ${missing ? 'border-2 border-accent-500 bg-accent-50' : ''}`}>
      <Avatar path={profile?.avatar_path} name={profile?.full_name} size={64} />
      <div className="min-w-0 flex-1 basis-48">
        <h2 id="photo-h" className="font-bold">{missing ? 'Add your profile photo' : 'Profile photo'}</h2>
        <p className="text-sm text-ink-soft">
          {missing
            ? 'Needed before you can book. It helps us welcome you at the door. Only you and studio staff can see it.'
            : 'Only you and studio staff can see your photo.'}
        </p>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="photo-input"
        onChange={(e) => void onFile(e.target.files?.[0])} />
      <label htmlFor="photo-input" className={`${missing ? 'btn-accent' : 'btn-outline'} btn-sm w-full shrink-0 cursor-pointer sm:w-auto`} aria-disabled={busy}>
        {busy && <Spinner />}{missing ? 'Add photo' : 'Change'}
      </label>
    </section>
  );
}
