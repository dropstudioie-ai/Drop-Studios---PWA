// Fonts are loaded from Google Fonts (open licences). Export waits for them to be ready.
export const FONTS = ['Inter', 'Montserrat', 'Poppins', 'DM Sans', 'Lato', 'Raleway', 'Oswald', 'Bebas Neue', 'Anton', 'Archivo Black',
  'Playfair Display', 'Roboto Slab', 'Permanent Marker', 'Pacifico'];

export async function ensureFonts(specs: { family: string; weight: number; italic?: boolean }[]) {
  if (!('fonts' in document)) return;
  const unique = [...new Set(specs.map((s) => `${s.italic ? 'italic ' : ''}${s.weight} 40px "${s.family}"`))];
  await Promise.all(unique.map((f) => document.fonts.load(f).catch(() => [])));
  await document.fonts.ready;
}
