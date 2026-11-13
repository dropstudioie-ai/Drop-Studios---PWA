// Turns an event brief (what you want + the photos to use) into several ready-made design options.
// Rule-based: it reads the theme and your words to pick colours and fonts, then lays the content
// out four different ways. Every option opens in the editor fully editable.
import type { Design, DesignElement, Fill } from '../model/types';
import { formatById } from '../model/types';
import { makeImage, uid } from '../model/elements';
import { coverCrop, grad, ic, page, r, sh, t } from '../templates/kit';

export interface BriefPhoto { src: string; width: number; height: number }
export interface Brief {
  title: string;
  kicker: string; // e.g. "Special themed class"
  date: string; // e.g. "Friday 28 November"
  time: string; // e.g. "18:30"
  instructor: string;
  description: string;
  dressCode: string;
  price: string; // e.g. "€25 · members €20" or ""
  look: string; // free text: what you want it to look like
  photos: BriefPhoto[];
  format: string;
  eventId: string | null;
}

export interface Mood { name: string; bg: string; bg2: string; accent: string; accent2: string; ink: string; head: string; body: string }

const MOODS: { match: RegExp; mood: Mood }[] = [
  { match: /christmas|xmas|festive|santa|jingle/i, mood: { name: 'Festive', bg: '#7f1d1d', bg2: '#14532d', accent: '#fbbf24', accent2: '#ffffff', ink: '#ffffff', head: 'Playfair Display', body: 'Inter' } },
  { match: /halloween|spooky|horror|witch|zombie/i, mood: { name: 'Spooky', bg: '#0b0b0d', bg2: '#3b0764', accent: '#ff7a00', accent2: '#a3e635', ink: '#ffffff', head: 'Anton', body: 'Inter' } },
  { match: /all black|black friday|noir|dark/i, mood: { name: 'All black', bg: '#050505', bg2: '#1f1f1f', accent: '#c6ff00', accent2: '#ffffff', ink: '#ffffff', head: 'Anton', body: 'Inter' } },
  { match: /pride|rainbow/i, mood: { name: 'Pride', bg: '#7c3aed', bg2: '#ec4899', accent: '#facc15', accent2: '#22d3ee', ink: '#ffffff', head: 'Archivo Black', body: 'Inter' } },
  { match: /valentine|love|galentine|heart/i, mood: { name: 'Love', bg: '#be123c', bg2: '#fb7185', accent: '#ffe4e6', accent2: '#ffffff', ink: '#ffffff', head: 'Playfair Display', body: 'DM Sans' } },
  { match: /patrick|paddy|irish|green/i, mood: { name: 'Green', bg: '#14532d', bg2: '#16a34a', accent: '#fde047', accent2: '#ffffff', ink: '#ffffff', head: 'Anton', body: 'Inter' } },
  { match: /neon|glow|uv|rave|80s|retro/i, mood: { name: 'Neon', bg: '#0b0221', bg2: '#4c1d95', accent: '#22d3ee', accent2: '#f0abfc', ink: '#ffffff', head: 'Archivo Black', body: 'Inter' } },
  { match: /summer|beach|sun|tropical|carnival|brazil/i, mood: { name: 'Summer', bg: '#f97316', bg2: '#facc15', accent: '#0e7490', accent2: '#ffffff', ink: '#0b0b0d', head: 'Anton', body: 'Inter' } },
  { match: /gold|glam|elegant|gala|new year|nye|white party/i, mood: { name: 'Glam', bg: '#0b0b0d', bg2: '#27272a', accent: '#d4af37', accent2: '#ffffff', ink: '#ffffff', head: 'Playfair Display', body: 'Inter' } },
  { match: /pink|barbie/i, mood: { name: 'Pink', bg: '#db2777', bg2: '#f472b6', accent: '#ffffff', accent2: '#0b0b0d', ink: '#ffffff', head: 'Anton', body: 'Inter' } },
  { match: /calm|yoga|stretch|mindful|wellbeing|relax/i, mood: { name: 'Calm', bg: '#f4efe6', bg2: '#cfe3d4', accent: '#1f3b2d', accent2: '#2f6f4f', ink: '#1f3b2d', head: 'Playfair Display', body: 'DM Sans' } },
];
const DROP_MOOD: Mood = { name: 'Drop', bg: '#0b0b0d', bg2: '#1f43e6', accent: '#ff7a00', accent2: '#ffffff', ink: '#ffffff', head: 'Anton', body: 'Inter' };

export function pickMood(text: string): Mood {
  return MOODS.find((m) => m.match.test(text))?.mood ?? DROP_MOOD;
}

function photo(p: BriefPhoto | undefined, x: number, y: number, w: number, h: number, o: { radius?: number; opacity?: number } = {}): DesignElement[] {
  if (!p) return [];
  return [makeImage({ src: p.src, x, y, width: w, height: h, crop: coverCrop(p.width, p.height, w, h, 0.5, 0.4), cornerRadius: o.radius ?? 0, opacity: o.opacity ?? 1, name: 'Photo' })];
}

const fit = (title: string, width: number, max: number) => Math.min(max, (width / Math.max(4, title.length)) * 1.75);

export function generateOptions(b: Brief): Design[] {
  const f = formatById(b.format) ?? formatById('ig-portrait')!;
  const W = f.width, H = f.height, u = Math.min(W, H) / 1080;
  const m = pickMood(`${b.title} ${b.look} ${b.description} ${b.dressCode}`);
  const [p1, p2, p3] = b.photos;
  const when = [b.date, b.time].filter(Boolean).join(' · ');
  const wear = b.dressCode ? `What to wear: ${b.dressCode} (encouraged, never required)` : '';
  const pad = 70 * u;
  const bgFill: Fill = grad([m.bg, m.bg2], 160);
  const TITLE = b.title.toUpperCase();

  const details = (x: number, y: number, w: number, color: string, accent: string): DesignElement[] => {
    const out: DesignElement[] = [];
    let yy = y;
    if (when) { out.push(ic('Calendar', x, yy, 46 * u, accent), t(when, x + 64 * u, yy + 4 * u, w - 64 * u, 34 * u, { fontFamily: m.body, fontWeight: 700, fill: color })); yy += 64 * u; }
    if (b.instructor) { out.push(ic('User', x, yy, 46 * u, accent), t(`with ${b.instructor}`, x + 64 * u, yy + 4 * u, w - 64 * u, 34 * u, { fontFamily: m.body, fontWeight: 600, fill: color })); yy += 64 * u; }
    if (b.price) { out.push(ic('Ticket', x, yy, 46 * u, accent), t(b.price, x + 64 * u, yy + 4 * u, w - 64 * u, 34 * u, { fontFamily: m.body, fontWeight: 700, fill: color })); yy += 64 * u; }
    if (wear) out.push(t(wear, x, yy + 10 * u, w, 26 * u, { fontFamily: m.body, fontWeight: 500, fill: color, opacity: 0.85, lineHeight: 1.35 }));
    return out;
  };

  const options: { name: string; pages: () => ReturnType<typeof page>[] }[] = [
    {
      name: 'Bold poster',
      pages: () => [page(m.bg, [
        ...photo(p1, 0, 0, W, H * 0.62),
        r(0, H * 0.38, W, H * 0.25, grad([`${m.bg}00`, m.bg], 180)),
        sh('rect', pad, pad, 360 * u, 64 * u, m.accent, { cornerRadius: 32 * u }),
        t(b.kicker.toUpperCase(), pad, pad + 17 * u, 360 * u, 26 * u, { fontFamily: m.body, fontWeight: 900, fill: m.bg, align: 'center', letterSpacing: 2 * u }),
        t(TITLE, pad, H * 0.56, W - pad * 2, fit(TITLE, W - pad * 2, 170 * u), { fontFamily: m.head, fontWeight: m.head === 'Anton' ? 400 : 900, fill: m.accent, lineHeight: 0.95 }),
        ...details(pad, H * 0.78, W - pad * 2, m.ink, m.accent),
      ])],
    },
    {
      name: 'Split',
      pages: () => [page(m.bg, [
        ...photo(p1, W * 0.45, 0, W * 0.55, H),
        r(W * 0.45, 0, 4 * u, H, m.accent),
        t(b.kicker.toUpperCase(), pad, pad * 1.5, W * 0.4 - pad, 26 * u, { fontFamily: m.body, fontWeight: 800, letterSpacing: 4 * u, fill: m.accent }),
        t(b.title, pad, pad * 2.4, W * 0.42 - pad, fit(b.title, W * 0.42 - pad, 120 * u), { fontFamily: m.head, fontWeight: m.head === 'Anton' ? 400 : 900, fill: m.ink, lineHeight: 1 }),
        t(b.description.slice(0, 160), pad, H * 0.45, W * 0.38 - pad, 28 * u, { fontFamily: m.body, fontWeight: 400, fill: m.ink, opacity: 0.85, lineHeight: 1.4 }),
        ...details(pad, H * 0.68, W * 0.4 - pad, m.ink, m.accent),
      ])],
    },
    {
      name: 'Framed',
      pages: () => [page(bgFill, [
        sh('ellipse', W * 0.55, -H * 0.1, W * 0.7, W * 0.7, 'rgba(255,255,255,0.08)'),
        t(b.kicker.toUpperCase(), pad, pad, W - pad * 2, 28 * u, { fontFamily: m.body, fontWeight: 800, letterSpacing: 8 * u, fill: m.accent, align: 'center' }),
        t(b.title, pad, pad + 60 * u, W - pad * 2, fit(b.title, W - pad * 2, 130 * u), { fontFamily: m.head, fontWeight: m.head === 'Anton' ? 400 : 900, fill: m.ink, align: 'center', lineHeight: 1 }),
        ...photo(p1, pad * 1.5, H * 0.3, W - pad * 3, H * 0.38, { radius: 40 * u }),
        ...(p2 ? photo(p2, W - pad * 1.5 - 220 * u, H * 0.6, 220 * u, 220 * u, { radius: 110 * u }) : []),
        ...details(pad * 1.5, H * 0.73, W - pad * 3, m.ink, m.accent),
      ])],
    },
    {
      name: 'Typographic',
      pages: () => [page(m.bg, [
        ...photo(p2 ?? p1, 0, 0, W, H, { opacity: 0.22 }),
        t(TITLE, pad * 0.7, H * 0.12, W - pad * 1.4, fit(TITLE, W - pad * 1.4, 220 * u), { fontFamily: m.head, fontWeight: m.head === 'Anton' ? 400 : 900, fill: 'rgba(0,0,0,0)', stroke: { color: m.accent, width: 4 * u }, lineHeight: 0.92 }),
        t(TITLE, pad * 0.7, H * 0.12 + 14 * u, W - pad * 1.4, fit(TITLE, W - pad * 1.4, 220 * u), { fontFamily: m.head, fontWeight: m.head === 'Anton' ? 400 : 900, fill: m.ink, lineHeight: 0.92 }),
        r(pad, H * 0.58, 140 * u, 10 * u, m.accent),
        t(b.description.slice(0, 180), pad, H * 0.61, W - pad * 2, 32 * u, { fontFamily: m.body, fontWeight: 500, fill: m.ink, lineHeight: 1.4 }),
        ...details(pad, H * 0.76, W - pad * 2, m.ink, m.accent),
        ...(p3 ? photo(p3, W - pad - 200 * u, pad, 200 * u, 200 * u, { radius: 100 * u }) : []),
      ])],
    },
  ];

  const now = Date.now();
  return options.map((o) => ({
    id: uid(), name: `${b.title}: ${o.name}`, width: W, height: H, format: f.id, pages: o.pages(), folderId: null,
    createdAt: now, updatedAt: now, dropEventId: b.eventId,
  }));
}
