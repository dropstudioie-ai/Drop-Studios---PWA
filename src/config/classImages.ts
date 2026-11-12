// Class artwork in public/classes (Spotlight design). Styles without artwork fall back to their colour.
const WITH_ART = new Set(['fitdance', 'commercial', 'hip-hop', 'jazz-funk', 'reggaeton', 'choreography']);

export function classImage(slug: string | null | undefined): { card: string; wide: string } | null {
  if (!slug || !WITH_ART.has(slug)) return null;
  return { card: `/classes/${slug}.webp`, wide: `/classes/${slug}-wide.webp` };
}
