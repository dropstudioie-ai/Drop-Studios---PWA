import { useState } from 'react';

// Real class photos (public/studio/photo-N.webp), shown whole at full resolution on an
// "Energy" background drawn in CSS (class-colour gradient + diagonal light bands), so
// nothing is cropped or enlarged and the banner stays sharp at any size.
export const STUDIO_PHOTOS = Array.from({ length: 12 }, (_, i) => `/studio/photo-${i + 1}.webp`);

// The class palettes from the Energy class images: [dark, mid, light].
const PALETTES = [
  ['#D94800', '#FF8A00', '#FFC21A'], // FitDance
  ['#A3124F', '#E8287A', '#FF7DB5'], // Reggaeton
  ['#0F24A8', '#2F5BFF', '#6FA0FF'], // Commercial
  ['#8E0B1F', '#E5243B', '#FF7A7A'], // Heels
  ['#4A1FB8', '#8B5CF6', '#C9A8FF'], // Jazz Funk
  ['#06695F', '#12B5A2', '#5FE6D2'], // Choreography
  ['#C77A00', '#F5B400', '#FFE45C'], // Hip Hop
];

/** A random studio photo (and colour) per visit. `index` fixes the choice in automated screenshots. */
export function StudioPhoto({ index, className = '', children }: { index?: number; className?: string; children?: React.ReactNode }) {
  const [pick] = useState(() => (index != null && typeof navigator !== 'undefined' && navigator.webdriver)
    ? index % STUDIO_PHOTOS.length
    : Math.floor(Math.random() * STUDIO_PHOTOS.length));
  const [dark, mid, light] = PALETTES[pick % PALETTES.length];
  return (
    <div className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{ background: `linear-gradient(135deg, ${dark} 0%, ${mid} 50%, ${light} 100%)` }}>
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg, transparent 0 22%, rgba(255,255,255,.16) 22% 34%, transparent 34% 58%, rgba(255,255,255,.11) 58% 64%, transparent 64%), linear-gradient(45deg, transparent 0 55%, rgba(0,0,0,.10) 55% 70%, transparent 70%)' }} />
      <div className="absolute bottom-0 right-[4%] top-[8%] flex max-w-[44%] items-end gap-3 sm:max-w-[62%] lg:gap-4">
        {[2, 1, 0].map((k) => (
          <img key={k} src={STUDIO_PHOTOS[(pick + k) % STUDIO_PHOTOS.length]} alt={k === 0 ? 'A class at Drop Studios' : ''} loading="lazy"
            className={`h-full w-auto min-w-0 rounded-t-2xl object-cover object-top shadow-[0_20px_40px_rgba(0,0,0,.35)] ring-4 ring-white/90 ${
              k === 0 ? '' : k === 1 ? 'hidden h-[88%] sm:block' : 'hidden h-[76%] lg:block'}`} />
        ))}
      </div>
      <div className="relative flex h-full max-w-[58%] flex-col sm:max-w-[40%] justify-between p-5 text-white sm:p-8">
        <img src="/brand/drop-logo-white.svg" alt="" className="h-6 w-auto self-start drop-shadow sm:h-8" />
        <div className="[text-shadow:0_2px_12px_rgba(0,0,0,.35)]">{children ?? (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-white/85">Real classes · real people</p>
            <p className="font-display text-xl font-black sm:text-3xl">Dance. Sweat. Smile.</p>
          </>
        )}</div>
      </div>
    </div>
  );
}
