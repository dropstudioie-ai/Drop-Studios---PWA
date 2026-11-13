import { useEffect, useState } from 'react';
import { assets } from '../storage/db';

// Uploaded images live in IndexedDB as blobs; designs refer to them as "asset:<id>".
const objectUrls = new Map<string, string>();
const images = new Map<string, Promise<HTMLImageElement>>();
const loaded = new Map<string, HTMLImageElement>();

export async function resolveSrc(src: string): Promise<string> {
  if (!src.startsWith('asset:')) return src;
  const id = src.slice(6);
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const a = await assets.get(id);
  if (!a) throw new Error('This uploaded image is missing from this browser.');
  const url = URL.createObjectURL(a.blob);
  objectUrls.set(id, url);
  return url;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = resolveSrc(src).then((url) => new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { loaded.set(src, img); res(img); };
      img.onerror = () => rej(new Error(`Couldn't load image ${src.slice(0, 60)}`));
      img.src = url;
    }));
    p.catch(() => images.delete(src));
    images.set(src, p);
  }
  return p;
}

/** Synchronous lookup for images that are already loaded (used by export rendering). */
export const loadedImage = (src: string) => loaded.get(src) ?? null;

export function useImage(src: string | null | undefined): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(() => (src ? loaded.get(src) ?? null : null));
  useEffect(() => {
    if (!src) { setImg(null); return; }
    const hit = loaded.get(src);
    if (hit) { setImg(hit); return; }
    let live = true;
    loadImage(src).then((i) => live && setImg(i)).catch(() => live && setImg(null));
    return () => { live = false; };
  }, [src]);
  return img;
}

/** Read an image file's natural size. */
export function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { res({ width: img.naturalWidth || 512, height: img.naturalHeight || 512 }); URL.revokeObjectURL(url); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not an image we can read.')); };
    img.src = url;
  });
}
