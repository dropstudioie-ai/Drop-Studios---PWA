// Class artwork in public/classes. Only images the studio has approved are listed here;
// other styles show their colour card until theirs is approved.
const APPROVED = new Set(['heels', 'fitdance']);

export function classImage(slug: string | null | undefined): { card: string; wide: string } | null {
  if (!slug || !APPROVED.has(slug)) return null;
  return { card: `/classes/${slug}.webp`, wide: `/classes/${slug}-wide.webp` };
}
