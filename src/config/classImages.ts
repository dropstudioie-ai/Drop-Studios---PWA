import { localDateKey } from '../domain/time';
// Class artwork in public/classes. Only images the studio has approved are listed here;
// other styles show their colour card until theirs is approved.
const APPROVED = new Set(['heels', 'fitdance', 'hip-hop', 'commercial', 'choreography', 'jazz-funk', 'reggaeton']);

export function classImage(slug: string | null | undefined): { card: string; wide: string } | null {
  if (!slug || !APPROVED.has(slug)) return null;
  return { card: `/classes/${slug}.webp`, wide: `/classes/${slug}-wide.webp` };
}

// Instructor-specific artwork: their own photo on their classes, optionally a colour per weekday.
// style slug -> instructor id -> file stem, or { weekday (0 = Sun) -> file stem }.
const BY_INSTRUCTOR: Record<string, Record<string, string | Record<number, string>>> = {
  fitdance: {
    // João Zublin: Tuesday pink, Thursday green, Saturday red.
    'f492a29e-4d0b-49de-b8ae-5683b6ef182a': { 2: 'fitdance-joao-pink', 4: 'fitdance-joao-green', 6: 'fitdance-joao-red' },
  },
};
const FALLBACK_DAY: Record<string, string> = { 'f492a29e-4d0b-49de-b8ae-5683b6ef182a': 'fitdance-joao-pink' };

/** The image for one class: the instructor's own if they have one, else the style's. */
export function sessionImage(slug: string | null | undefined, instructorId: string | null | undefined, startsAt?: string) {
  const entry = slug && instructorId ? BY_INSTRUCTOR[slug]?.[instructorId] : undefined;
  let own: string | undefined;
  if (typeof entry === 'string') own = entry;
  else if (entry) {
    const day = startsAt ? new Date(`${localDateKey(new Date(startsAt))}T12:00:00Z`).getUTCDay() : -1;
    own = entry[day] ?? FALLBACK_DAY[instructorId!];
  }
  if (own) return { card: `/classes/${own}.webp`, wide: `/classes/${own}-wide.webp` };
  return classImage(slug);
}
