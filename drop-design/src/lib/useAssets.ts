import { useCallback, useEffect, useState } from 'react';
import type { Asset } from '../model/types';
import { assets as store } from '../storage/db';

const listeners = new Set<() => void>();
export const notifyAssets = () => listeners.forEach((l) => l());

/** Uploaded assets with object URLs for thumbnails; refreshes when anything uploads. */
export function useAssets() {
  const [list, setList] = useState<(Asset & { url: string })[] | null>(null);
  const load = useCallback(async () => {
    const all = await store.list();
    setList((prev) => {
      prev?.forEach((p) => URL.revokeObjectURL(p.url));
      return all.map((a) => ({ ...a, url: URL.createObjectURL(a.blob) }));
    });
  }, []);
  useEffect(() => { void load(); listeners.add(load); return () => { listeners.delete(load); }; }, [load]);
  return { list, reload: load };
}
