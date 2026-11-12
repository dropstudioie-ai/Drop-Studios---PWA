import { useState } from 'react';

// Real class photos (public/studio/photo-N.webp), shown whole at full resolution on an
// "Energy" background drawn in CSS. Each photo sits on a class colour that matches its
// own light, and the photos shown together always come from the same group.
const photo = (n: number) => `/studio/photo-${n}.webp`;

type Palette = [string, string, string];
const FITDANCE: Palette = ['#D94800', '#FF8A00', '#FFC21A'];
const HIP_HOP: Palette = ['#C77A00', '#F5B400', '#FFE45C'];
const HEELS: Palette = ['#8E0B1F', '#E5243B', '#FF7A7A'];
const JAZZ_FUNK: Palette = ['#4A1FB8', '#8B5CF6', '#C9A8FF'];
const COMMERCIAL: Palette = ['#0F24A8', '#2F5BFF', '#6FA0FF'];
const CHOREOGRAPHY: Palette = ['#06695F', '#12B5A2', '#5FE6D2'];

const GROUPS: { photos: number[]; palettes: Palette[]; wide?: boolean }[] = [
  { photos: [2, 3, 4, 6, 7, 12], palettes: [JAZZ_FUNK] },             // purple club light
  { photos: [1, 5, 8], palettes: [FITDANCE, HIP_HOP, HEELS] },        // warm wooden floors
  { photos: [9, 10, 11], palettes: [COMMERCIAL, CHOREOGRAPHY] },      // cool blue / grey rooms
  { photos: [14, 15, 13, 16], palettes: [COMMERCIAL, CHOREOGRAPHY], wide: true }, // blue-wall studio (pro photos)
];
export const STUDIO_PHOTOS = GROUPS.flatMap((g) => g.photos).map(photo);

/** A random group, photo and matching colour per visit. `index` fixes the choice in automated screenshots. */
export function StudioPhoto({ index, className = '', children, single = false }: { index?: number; className?: string; children?: React.ReactNode; single?: boolean }) {
  const [choice] = useState(() => {
    const fixed = index != null && typeof navigator !== 'undefined' && navigator.webdriver;
    const r = fixed ? index! : Math.floor(Math.random() * 1000);
    const g = GROUPS[r % GROUPS.length];
    return { group: g, start: Math.floor(r / GROUPS.length) % g.photos.length, palette: g.palettes[Math.floor(r / 7) % g.palettes.length] };
  });
  const { group, start, palette: [dark, mid, light] } = choice;
  const shown = [0, 1, 2].map((k) => photo(group.photos[(start + k) % group.photos.length]));
  return (
    <div className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{ background: `linear-gradient(135deg, ${dark} 0%, ${mid} 50%, ${light} 100%)` }}>
      <div aria-hidden="true" className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg, transparent 0 22%, rgba(255,255,255,.16) 22% 34%, transparent 34% 58%, rgba(255,255,255,.11) 58% 64%, transparent 64%), linear-gradient(45deg, transparent 0 55%, rgba(0,0,0,.10) 55% 70%, transparent 70%)' }} />
      <div className={`absolute bottom-0 right-[4%] top-[8%] flex items-end gap-3 lg:gap-4 ${group.wide ? 'max-w-[52%] sm:max-w-[58%]' : 'max-w-[44%] sm:max-w-[62%]'}`}>
        {[2, 1, 0].map((k) => (
          <img key={k} src={shown[k]} alt={k === 0 ? 'A class at Drop Studios' : ''} loading="lazy"
            className={`h-full w-auto min-w-0 rounded-t-2xl object-cover object-top shadow-[0_20px_40px_rgba(0,0,0,.35)] ring-4 ring-white/90 ${
              k === 0 ? '' : single || group.wide ? 'hidden' : k === 1 ? 'hidden sm:block' : 'hidden lg:block'}`} />
        ))}
      </div>
      <div className="relative flex h-full max-w-[58%] flex-col justify-between p-5 text-white sm:max-w-[40%] sm:p-8">
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
