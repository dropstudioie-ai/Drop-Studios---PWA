// Class artwork in public/classes. Only images the studio has approved are listed here;
// other styles show their colour card until theirs is approved.
const APPROVED = new Set(['heels', 'fitdance', 'hip-hop', 'commercial', 'choreography', 'jazz-funk', 'reggaeton']);

export function classImage(slug: string | null | undefined): { card: string; wide: string } | null {
  if (!slug || !APPROVED.has(slug)) return null;
  return { card: `/classes/${slug}.webp`, wide: `/classes/${slug}-wide.webp` };
}

// Instructor-specific artwork: their own photo on their classes (style slug -> instructor id -> file stem).
const BY_INSTRUCTOR: Record<string, Record<string, string>> = {
  fitdance: { 'f492a29e-4d0b-49de-b8ae-5683b6ef182a': 'fitdance-joao' }, // João Zublin (Tue, Thu, Sat)
};

/** The image for one class: the instructor's own if they have one, else the style's. */
export function sessionImage(slug: string | null | undefined, instructorId: string | null | undefined) {
  const own = slug && instructorId ? BY_INSTRUCTOR[slug]?.[instructorId] : undefined;
  if (own) return { card: `/classes/${own}.webp`, wide: `/classes/${own}-wide.webp` };
  return classImage(slug);
}
