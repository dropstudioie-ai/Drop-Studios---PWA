import { supabase } from './supabase';

// Profile photos live in the private "avatars" bucket at <user id>/<file>.
// Only the owner and studio staff can read them (storage policies).
const BUCKET = 'avatars';
const SIZE = 512;

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Crops to a centred square and shrinks to 512×512 JPEG. */
export async function squareJpeg(file: File, size = SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', 0.85),
  );
}

export async function uploadProfilePhoto(userId: string, file: File, previousPath: string | null): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error('Please choose a JPG, PNG or WebP photo.');
  const blob = await squareJpeg(file);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('The photo could not be uploaded. Please try again.');
  const { error: saveError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
  if (saveError) throw new Error('The photo was uploaded but could not be saved to your profile.');
  if (previousPath && previousPath !== path) await supabase.storage.from(BUCKET).remove([previousPath]);
  urlCache.delete(previousPath ?? '');
  return path;
}

const urlCache = new Map<string, { url: string; expires: number }>();

/** Short-lived signed URL for showing a private photo. */
export async function photoUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60_000 });
  return data.signedUrl;
}
