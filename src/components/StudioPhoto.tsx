import { useState } from 'react';

// Real class photos from the studio (public/studio), edited to one standard Drop look.
export const STUDIO_PHOTOS = Array.from({ length: 14 }, (_, i) => `/studio/class-${i + 1}.webp`);

/** A random studio photo, picked once per visit to the page. `index` is kept as the first choice for screenshots/tests. */
export function StudioPhoto({ index, className = '', children }: { index?: number; className?: string; children?: React.ReactNode }) {
  const [pick] = useState(() => (index != null && typeof navigator !== 'undefined' && navigator.webdriver)
    ? index % STUDIO_PHOTOS.length
    : Math.floor(Math.random() * STUDIO_PHOTOS.length));
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-ink ${className}`}>
      <img src={STUDIO_PHOTOS[pick]} alt="A class at Drop Studios" width={1600} height={900} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      {children && <div className="relative flex h-full flex-col justify-end p-5 text-white sm:p-8">{children}</div>}
    </div>
  );
}
