// Real class photos from the studio (public/studio), edited to the Drop look.
export const STUDIO_PHOTOS = Array.from({ length: 14 }, (_, i) => `/studio/class-${i + 1}.webp`);

/** A different photo per page, the same one each visit, so pages don't flicker between photos. */
export function StudioPhoto({ index, className = '', children }: { index: number; className?: string; children?: React.ReactNode }) {
  const src = STUDIO_PHOTOS[index % STUDIO_PHOTOS.length];
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-ink ${className}`}>
      <img src={src} alt="A class at Drop Studios" width={1600} height={900} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      {children && <div className="relative flex h-full flex-col justify-end p-5 text-white sm:p-8">{children}</div>}
    </div>
  );
}
