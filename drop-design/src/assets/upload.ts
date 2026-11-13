import type { Asset } from '../model/types';
import { uid } from '../model/elements';
import { assets } from '../storage/db';
import { imageSize } from '../lib/images';

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp'];
export const ACCEPT_ATTR = '.jpg,.jpeg,.png,.svg,.webp,image/jpeg,image/png,image/svg+xml,image/webp';
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_SIDE = 4000; // larger photos are scaled down to keep projects fast

async function downscale(file: File, w: number, h: number): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type === 'image/svg+xml' || Math.max(w, h) <= MAX_SIDE) return { blob: file, width: w, height: h };
  const s = MAX_SIDE / Math.max(w, h);
  const cw = Math.round(w * s), ch = Math.round(h * s);
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  c.getContext('2d')!.drawImage(bmp, 0, 0, cw, ch);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not resize image'))), type, 0.92));
  return { blob, width: cw, height: ch };
}

/** Save image files into the browser's asset library. Throws a friendly error for unsupported files. */
export async function importFiles(files: File[], kind: Asset['kind']): Promise<Asset[]> {
  const out: Asset[] = [];
  for (const f of files) {
    const type = f.type || (f.name.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : '');
    if (!ACCEPTED.includes(type)) throw new Error(`${f.name}: only JPG, PNG, SVG and WebP images are supported.`);
    if (f.size > MAX_BYTES) throw new Error(`${f.name} is larger than 25 MB.`);
    const dims = await imageSize(f);
    const { blob, width, height } = await downscale(f, dims.width, dims.height);
    const a: Asset = { id: uid(), name: f.name.replace(/\.[^.]+$/, ''), type: blob.type || type, kind, width, height, size: blob.size, blob, tags: [], createdAt: Date.now() };
    await assets.save(a);
    out.push(a);
  }
  return out;
}
