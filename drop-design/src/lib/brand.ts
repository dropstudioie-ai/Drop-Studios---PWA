import { useCallback, useEffect, useState } from 'react';
import type { BrandKit } from '../model/types';
import { brandStore } from '../storage/db';

export const DEFAULT_BRAND: BrandKit = {
  id: 'brand', name: 'Drop Studios', logos: [], primary: '#1f43e6', secondary: '#ff7a00',
  palette: ['#0b0b0d', '#ffffff', '#1f43e6', '#ff7a00', '#14e0a8', '#f5f5f4'],
  headingFont: 'Anton', bodyFont: 'Inter',
  textStyles: [
    { id: 'h1', name: 'Headline', fontFamily: 'Anton', fontSize: 140, fontWeight: 400, fill: '#0b0b0d', letterSpacing: 0, uppercase: true },
    { id: 'h2', name: 'Subheading', fontFamily: 'Inter', fontSize: 48, fontWeight: 800, fill: '#1f43e6', letterSpacing: 2 },
    { id: 'body', name: 'Body', fontFamily: 'Inter', fontSize: 32, fontWeight: 400, fill: '#334155', letterSpacing: 0 },
  ],
};

const listeners = new Set<(b: BrandKit) => void>();

export function useBrand() {
  const [brand, setBrand] = useState<BrandKit | null>(null);
  useEffect(() => {
    let live = true;
    brandStore.get().then((b) => live && setBrand(b ?? DEFAULT_BRAND));
    const l = (b: BrandKit) => setBrand(b);
    listeners.add(l);
    return () => { live = false; listeners.delete(l); };
  }, []);
  const save = useCallback(async (b: BrandKit) => {
    await brandStore.save(b);
    listeners.forEach((l) => l(b));
  }, []);
  return { brand, save };
}
