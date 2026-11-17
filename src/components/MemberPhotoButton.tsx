import { useId, useState } from 'react';
import { uploadMemberPhoto, ACCEPTED_TYPES } from '../lib/avatar';
import { Spinner, useToast } from './ui';

/** Staff: take or upload a member's profile photo (on a phone this offers the camera or the photo library). */
export function MemberPhotoButton({ memberId, name, hasPhoto, onSaved, className = 'btn-outline btn-sm' }: {
  memberId: string; name: string | null; hasPhoto: boolean; onSaved: (path: string) => void; className?: string;
}) {
  const id = useId();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function onFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const path = await uploadMemberPhoto(memberId, file);
      toast(`Photo ${hasPhoto ? 'updated' : 'added'} for ${name?.split(' ')[0] || 'this member'}.`);
      onSaved(path);
    } catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); input.value = ''; }
  }
  return (
    <>
      <input id={id} type="file" accept={ACCEPTED_TYPES.join(',')} className="sr-only" onChange={(e) => void onFile(e.currentTarget)} disabled={busy} />
      <label htmlFor={id} className={`${className} cursor-pointer`} aria-disabled={busy}>
        {busy && <Spinner />}📷 {hasPhoto ? 'Change photo' : 'Add photo'}
      </label>
    </>
  );
}
