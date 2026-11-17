// Draws Thamires' Instagram Stories on the server (1080×1920 PNG), so she can post them on her own:
// one Story per class each morning, and next week's timetable on Friday, Saturday and Sunday evenings.
// Images and fonts are loaded through `Assets` (the assistant-media bucket in production, files in tests).
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

export interface Assets { get(path: string): Promise<Uint8Array> }

const W = 1080, H = 1920, ORANGE = '#ff7a00', INK = '#0b0b0d', GOLD = '#d4af37';
const FONT_FILES = ['fonts/Archivo-900.ttf', 'fonts/Archivo-800.ttf', 'fonts/Inter-600.ttf', 'fonts/Inter-700.ttf', 'fonts/Inter-800.ttf'];
let ready: Promise<Uint8Array[]> | null = null;

/** Load the drawing engine and Drop's fonts once per server instance. */
function init(a: Assets): Promise<Uint8Array[]> {
  ready ??= (async () => {
    await initWasm(await a.get('fonts/resvg.wasm'));
    return Promise.all(FONT_FILES.map((f) => a.get(f)));
  })();
  return ready;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dataUri = (bytes: Uint8Array, mime = 'image/jpeg') => `data:${mime};base64,${encodeBase64(bytes)}`;

/** Rough text width (no measuring on the server): good enough to shrink long names so they fit. */
function textWidth(s: string, size: number, family: 'head' | 'body') {
  let w = 0;
  for (const ch of s) w += ch === ' ' ? 0.28 : /[0-9]/.test(ch) ? 0.64 : /[A-Z]/.test(ch) ? (family === 'head' ? 0.74 : 0.68) : /[iljtf.,:·']/.test(ch) ? 0.3 : 0.56;
  return w * size;
}
function fit(s: string, size: number, max: number, family: 'head' | 'body', min = 28) {
  while (textWidth(s, size, family) > max && size > min) size -= 2;
  return size;
}
const text = (x: number, y: number, s: string, size: number, font: string, fill: string, extra = '') =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" fill="${fill}" ${extra}>${esc(s)}</text>`;

/** A five-pointed star (the fonts have no ★). */
function star(cx: number, cy: number, r: number, fill: string) {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  });
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

/** "Book now" sticker, like an Instagram link sticker. */
function sticker(y: number) {
  const cy = y + 60;
  return `<rect x="80" y="${y}" width="920" height="120" rx="28" fill="#ffffff"/>
    <circle cx="150" cy="${cy}" r="40" fill="${ORANGE}"/>
    <path d="M134 ${cy + 16} L166 ${cy - 16} M140 ${cy - 16} L166 ${cy - 16} L166 ${cy + 10}" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    ${text(214, y + 58, 'BOOK NOW', 46, 'Archivo 900', INK)}
    ${text(214, y + 98, 'dropstudios.ie/app', 34, 'Inter 700', ORANGE)}`;
}

async function png(svg: string, a: Assets) {
  const fonts = await init(a);
  return new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter 600' } }).render().asPng();
}

export interface DayClass { time: string; title: string; instructor: string | null }
/** The photo for a class Story: Drop's class artwork (4:5, shown as a card) or a full-screen photo. */
export interface StoryPhoto { kind: 'artwork' | 'photo'; image: Uint8Array; blurred?: Uint8Array }

/** One class's Story: artwork (or photo), the day, the time and class in big type, and the Book now sticker. */
export async function renderClassStory(a: Assets, o: { date: string; cls: DayClass; photo: StoryPhoto; logo?: string }): Promise<Uint8Array> {
  const dateLabel = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${o.date}T12:00:00Z`)).toUpperCase();
  const top = 1330;
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${INK}"/>`];
  if (o.photo.kind === 'artwork') {
    // Blurred artwork fills the screen, the sharp artwork on top: the class colour everywhere, no empty space.
    if (o.photo.blurred) parts.push(`<image href="${dataUri(o.photo.blurred)}" x="-40" y="-40" width="${W + 80}" height="${H + 80}" preserveAspectRatio="xMidYMid slice"/>`);
    parts.push(`<rect width="${W}" height="${H}" fill="rgba(11,11,13,0.35)"/>`);
    parts.push(`<image href="${dataUri(o.photo.image)}" x="0" y="0" width="${W}" height="1350" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    parts.push(`<image href="${dataUri(o.photo.image)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
    if (o.logo) parts.push(`<image href="${o.logo}" x="64" y="72" width="300" height="71"/>`);
  }
  // Dark fade behind the text so it's always readable.
  parts.push(`<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.9"/></linearGradient></defs>
    <rect x="0" y="${top - 380}" width="${W}" height="420" fill="url(#fade)"/><rect x="0" y="${top + 40}" width="${W}" height="${H - top - 40}" fill="${INK}" fill-opacity="0.9"/>`);
  const name = o.cls.title.toUpperCase();
  parts.push(text(80, top, `TODAY · ${dateLabel}`, 40, 'Inter 800', ORANGE));
  parts.push(text(74, top + 160, o.cls.time, 150, 'Archivo 900', ORANGE));
  parts.push(text(78, top + 262, name, fit(name, 96, 920, 'head'), 'Archivo 900', '#ffffff'));
  if (o.cls.instructor) parts.push(text(80, top + 322, `with ${o.cls.instructor}`, 44, 'Inter 600', '#d4d4d8'));
  parts.push(sticker(1726));
  return png(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`, a);
}

export interface WeekDay { date: string; items: { time: string; title: string; instructor: string | null; special: string | null }[] }

/** Next week's timetable on one Story: every class Monday to Sunday, special events in gold. */
export async function renderWeekStory(a: Assets, o: { weekStart: string; days: WeekDay[]; background?: Uint8Array; logo?: string }): Promise<Uint8Array> {
  const d = (k: string, opt: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IE', { ...opt, timeZone: 'UTC' }).format(new Date(`${k}T12:00:00Z`));
  const end = new Date(Date.parse(`${o.weekStart}T12:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
  const range = `${d(o.weekStart, { day: 'numeric', month: 'short' })} – ${d(end, { day: 'numeric', month: 'short' })}`.toUpperCase();
  const days = o.days.filter((x) => x.items.length);
  const rows = days.reduce((n, x) => n + x.items.length, 0);
  // Fit everything between the header and the sticker: shrink the type when the week is busy.
  const avail = 1690 - 540;
  const unit = Math.min(1, avail / (rows * 92 + days.length * 40));
  const row = Math.round(92 * unit), gap = Math.round(40 * unit), fs = Math.round(54 * Math.max(unit, 0.7)), small = Math.round(30 * Math.max(unit, 0.75));
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="${INK}"/>`];
  if (o.background) parts.push(`<image href="${dataUri(o.background)}" x="-40" y="-40" width="${W + 80}" height="${H + 80}" preserveAspectRatio="xMidYMid slice" opacity="0.55"/>`);
  parts.push(`<defs><radialGradient id="glow" cx="0.85" cy="0.05" r="0.7"><stop offset="0" stop-color="${ORANGE}" stop-opacity="0.35"/><stop offset="1" stop-color="${ORANGE}" stop-opacity="0"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="${INK}" fill-opacity="0.72"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`);
  if (o.logo) parts.push(`<image href="${o.logo}" x="80" y="110" width="260" height="62"/>`);
  parts.push(text(80, 290, 'NEXT WEEK AT DROP', 44, 'Inter 800', ORANGE, 'letter-spacing="4"'));
  parts.push(text(76, 430, range, fit(range, 132, 930, 'head'), 'Archivo 900', '#ffffff'));
  parts.push(`<rect x="80" y="480" width="140" height="10" rx="5" fill="${ORANGE}"/>`);
  let y = 540;
  if (!days.length) parts.push(text(80, y + 80, 'Timetable coming soon', 56, 'Archivo 800', '#ffffff'));
  for (const day of days) {
    y += gap;
    parts.push(text(80, y + fs * 0.85, d(day.date, { weekday: 'short' }).toUpperCase(), Math.round(fs * 0.8), 'Archivo 900', ORANGE));
    parts.push(text(80, y + fs * 0.85 + small + 6, d(day.date, { day: 'numeric', month: 'short' }), small, 'Inter 600', '#a1a1aa'));
    for (const it of day.items) {
      const special = Boolean(it.special);
      const title = (it.special ?? it.title).toUpperCase();
      const tx = 400;
      const nameX = special ? tx + 40 : tx;
      if (special) {
        parts.push(`<rect x="${tx - 24}" y="${y - 2}" width="${1000 - tx + 44}" height="${Math.round(fs * 0.85 + small + 18)}" rx="18" fill="${GOLD}" fill-opacity="0.16" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/>`);
        parts.push(star(tx + 14, y + fs * 0.85 - fs * 0.28, fs * 0.3, GOLD));
      }
      parts.push(text(250, y + fs * 0.85, it.time, Math.round(fs * 0.8), 'Archivo 800', special ? GOLD : '#ffffff'));
      parts.push(text(nameX, y + fs * 0.85, title, fit(title, Math.round(fs * 0.8), 1000 - nameX, 'head', 22), 'Archivo 900', special ? GOLD : '#ffffff'));
      if (it.instructor) parts.push(text(nameX, y + fs * 0.85 + small + 4, `with ${it.instructor}`, small, 'Inter 600', special ? '#e9d58a' : '#a1a1aa'));
      y += row;
    }
  }
  parts.push(sticker(1726));
  return png(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`, a);
}

// ---------- Which artwork for a class (mirrors src/config/classImages.ts) ----------
const APPROVED = new Set(['heels', 'fitdance', 'hip-hop', 'commercial', 'choreography', 'jazz-funk', 'reggaeton']);
const BY_INSTRUCTOR: Record<string, Record<string, Record<number, string>>> = {
  fitdance: { 'f492a29e-4d0b-49de-b8ae-5683b6ef182a': { 2: 'fitdance-joao-pink', 4: 'fitdance-joao-green', 6: 'fitdance-joao-red' } },
};
const FALLBACK_DAY: Record<string, string> = { 'f492a29e-4d0b-49de-b8ae-5683b6ef182a': 'fitdance-joao-pink' };

/** Asset path stem for a class's artwork ("classes/heels"), or null when the style has none. */
export function artworkFor(slug: string | null, instructorId: string | null | undefined, date: string): string | null {
  const own = slug && instructorId ? BY_INSTRUCTOR[slug]?.[instructorId] : undefined;
  if (own) return `classes/${own[new Date(`${date}T12:00:00Z`).getUTCDay()] ?? FALLBACK_DAY[instructorId!]}`;
  return slug && APPROVED.has(slug) ? `classes/${slug}` : null;
}

/** Turn a photo chosen in the admin page into an asset path or a full URL. */
export function photoSource(url: string): { asset: string } | { url: string } {
  const m = url.match(/^\/(classes|studio)\/([a-z0-9-]+)\.webp$/);
  return m ? { asset: `${m[1]}/${m[2]}` } : { url };
}

/** Drop's white logo, for drawing on Stories. */
export const DROP_LOGO = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjQ3IDE0MyAyODUgNjciPgogIDxkZWZzPjxtYXNrIGlkPSJjdXQiIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9IjQwIiB5PSIxMzUiIHdpZHRoPSIzMDAiIGhlaWdodD0iODAiPgogICAgPHJlY3QgeD0iNDAiIHk9IjEzNSIgd2lkdGg9IjMwMCIgaGVpZ2h0PSI4MCIgZmlsbD0iI2ZmZiIvPjxnIGZpbGw9IiMwMDAiPjxyZWN0IHg9IjYyLjQiIHk9IjE0MCIgd2lkdGg9IjMuOCIgaGVpZ2h0PSI3NSIvPjxyZWN0IHg9IjIyMy4xIiB5PSIxNDAiIHdpZHRoPSIzLjgiIGhlaWdodD0iNzUiLz48L2c+PC9tYXNrPjwvZGVmcz4KICA8ZyBmaWxsPSIjRkZGRkZGIiBtYXNrPSJ1cmwoI2N1dCkiPjxwYXRoIHRyYW5zZm9ybT0idHJhbnNsYXRlKDQzLjcxNDMyNyAyMDguMjgyNDEpIiBkPSJNIDU1LjE4NzUgLTYzLjE3MTg3NSBDIDU3IC02My4xNzE4NzUgNTguNjkxNDA2IC02Mi44MzIwMzEgNjAuMjY1NjI1IC02Mi4xNTYyNSBDIDYxLjg0NzY1NiAtNjEuNDg4MjgxIDYzLjIyMjY1NiAtNjAuNTY2NDA2IDY0LjM5MDYyNSAtNTkuMzkwNjI1IEMgNjUuNTY2NDA2IC01OC4yMjI2NTYgNjYuNTAzOTA2IC01Ni44NDc2NTYgNjcuMjAzMTI1IC01NS4yNjU2MjUgQyA2Ny44OTg0MzggLTUzLjY5MTQwNiA2OC4yNSAtNTIgNjguMjUgLTUwLjE4NzUgTCA2OC4yNSAtMTIuOTg0Mzc1IEMgNjguMjUgLTExLjE3MTg3NSA2Ny44OTg0MzggLTkuNDcyNjU2IDY3LjIwMzEyNSAtNy44OTA2MjUgQyA2Ni41MDM5MDYgLTYuMzE2NDA2IDY1LjU2NjQwNiAtNC45NDE0MDYgNjQuMzkwNjI1IC0zLjc2NTYyNSBDIDYzLjIyMjY1NiAtMi41OTc2NTYgNjEuODQ3NjU2IC0xLjY3NTc4MSA2MC4yNjU2MjUgLTEgQyA1OC42OTE0MDYgLTAuMzMyMDMxIDU3IDAgNTUuMTg3NSAwIEwgNS4wOTM3NSAwIEwgNS4wOTM3NSAtNjMuMTcxODc1IFogTSAxOC42ODc1IC0xMy42ODc1IEwgNTQuNDg0Mzc1IC0xMy42ODc1IEwgNTQuNDg0Mzc1IC00OS40ODQzNzUgTCAxOC42ODc1IC00OS40ODQzNzUgWiBNIDE4LjY4NzUgLTEzLjY4NzUgIi8+PHBhdGggdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMTE2Ljg4MTIyMSAyMDguMjgyNDEpIiBkPSJNIDY4IC0zMy43ODEyNSBDIDY4IC0zMi4wMTk1MzEgNjcuNjQ0NTMxIC0zMC4zNDc2NTYgNjYuOTM3NSAtMjguNzY1NjI1IEMgNjYuMjM4MjgxIC0yNy4xOTE0MDYgNjUuMzAwNzgxIC0yNS44MDQ2ODggNjQuMTI1IC0yNC42MDkzNzUgQyA2Mi45NTcwMzEgLTIzLjQxMDE1NiA2MS41ODIwMzEgLTIyLjQ3MjY1NiA2MCAtMjEuNzk2ODc1IEMgNTguNDI1NzgxIC0yMS4xMjg5MDYgNTYuNzM0Mzc1IC0yMC43OTY4NzUgNTQuOTIxODc1IC0yMC43OTY4NzUgTCA1NC4zMTI1IC0yMC43OTY4NzUgQyA1Ni41MzEyNSAtMTguMTYwMTU2IDU4LjgwNDY4OCAtMTUuNDY4NzUgNjEuMTQwNjI1IC0xMi43MTg3NSBDIDYzLjQ4NDM3NSAtOS45Njg3NSA2NS43Njk1MzEgLTcuMjgxMjUgNjggLTQuNjU2MjUgTCA2OCAwIEwgNTMuOTUzMTI1IDAgTCAzNi41IC0yMC43OTY4NzUgTCAxOC40MjE4NzUgLTIwLjcwMzEyNSBDIDE4LjU5NzY1NiAtMjAuNzAzMTI1IDE4LjY4NzUgLTIwLjUyMzQzOCAxOC42ODc1IC0yMC4xNzE4NzUgTCAxOC41OTM3NSAtMjAuMTcxODc1IEMgMTguNDc2NTYyIC0yMC4xNzE4NzUgMTguNDIxODc1IC0yMC4yMDMxMjUgMTguNDIxODc1IC0yMC4yNjU2MjUgTCAxOC40MjE4NzUgMCBMIDQuODI4MTI1IDAgTCA0LjgyODEyNSAtNjMuMDc4MTI1IEwgNTQuOTIxODc1IC02My4wNzgxMjUgQyA1Ni43MzQzNzUgLTYzLjA3ODEyNSA1OC40MjU3ODEgLTYyLjczODI4MSA2MCAtNjIuMDYyNSBDIDYxLjU4MjAzMSAtNjEuMzk0NTMxIDYyLjk1NzAzMSAtNjAuNDYwOTM4IDY0LjEyNSAtNTkuMjY1NjI1IEMgNjUuMzAwNzgxIC01OC4wNjY0MDYgNjYuMjM4MjgxIC01Ni42NzU3ODEgNjYuOTM3NSAtNTUuMDkzNzUgQyA2Ny42NDQ1MzEgLTUzLjUxOTUzMSA2OCAtNTEuODUxNTYyIDY4IC01MC4wOTM3NSBaIE0gMTguNDIxODc1IC0zNC40ODQzNzUgTCA1NC4yMTg3NSAtMzQuNDg0Mzc1IEwgNTQuMjE4NzUgLTQ5LjQ4NDM3NSBMIDE4LjQyMTg3NSAtNDkuNDg0Mzc1IFogTSAxOC40MjE4NzUgLTM0LjQ4NDM3NSAiLz48cGF0aCB0cmFuc2Zvcm09InRyYW5zbGF0ZSgxODkuMjU4NTI2IDIwOC4yODI0MSkiIGQ9Ik0gNTQuOTIxODc1IC02My4xNzE4NzUgQyA1Ni42NzE4NzUgLTYzLjE3MTg3NSA1OC4zMzU5MzggLTYyLjgzMjAzMSA1OS45MjE4NzUgLTYyLjE1NjI1IEMgNjEuNTAzOTA2IC02MS40ODgyODEgNjIuODk0NTMxIC02MC41NjY0MDYgNjQuMDkzNzUgLTU5LjM5MDYyNSBDIDY1LjI4OTA2MiAtNTguMjIyNjU2IDY2LjIyMjY1NiAtNTYuODQ3NjU2IDY2Ljg5MDYyNSAtNTUuMjY1NjI1IEMgNjcuNTY2NDA2IC01My42OTE0MDYgNjcuOTA2MjUgLTUyIDY3LjkwNjI1IC01MC4xODc1IEwgNjcuOTA2MjUgLTEyLjk4NDM3NSBDIDY3LjkwNjI1IC0xMS4xNzE4NzUgNjcuNTY2NDA2IC05LjQ3MjY1NiA2Ni44OTA2MjUgLTcuODkwNjI1IEMgNjYuMjIyNjU2IC02LjMxNjQwNiA2NS4yODkwNjIgLTQuOTQxNDA2IDY0LjA5Mzc1IC0zLjc2NTYyNSBDIDYyLjg5NDUzMSAtMi41OTc2NTYgNjEuNTAzOTA2IC0xLjY3NTc4MSA1OS45MjE4NzUgLTEgQyA1OC4zMzU5MzggLTAuMzMyMDMxIDU2LjY3MTg3NSAwIDU0LjkyMTg3NSAwIEwgMTcuNzE4NzUgMCBDIDE1LjkwNjI1IDAgMTQuMjA3MDMxIC0wLjMzMjAzMSAxMi42MjUgLTEgQyAxMS4wNTA3ODEgLTEuNjc1NzgxIDkuNjc1NzgxIC0yLjU5NzY1NiA4LjUgLTMuNzY1NjI1IEMgNy4zMzIwMzEgLTQuOTQxNDA2IDYuNDEwMTU2IC02LjMxNjQwNiA1LjczNDM3NSAtNy44OTA2MjUgQyA1LjA2NjQwNiAtOS40NzI2NTYgNC43MzQzNzUgLTExLjE3MTg3NSA0LjczNDM3NSAtMTIuOTg0Mzc1IEwgNC43MzQzNzUgLTUwLjE4NzUgQyA0LjczNDM3NSAtNTIgNS4wNjY0MDYgLTUzLjY5MTQwNiA1LjczNDM3NSAtNTUuMjY1NjI1IEMgNi40MTAxNTYgLTU2Ljg0NzY1NiA3LjMzMjAzMSAtNTguMjIyNjU2IDguNSAtNTkuMzkwNjI1IEMgOS42NzU3ODEgLTYwLjU2NjQwNiAxMS4wNTA3ODEgLTYxLjQ4ODI4MSAxMi42MjUgLTYyLjE1NjI1IEMgMTQuMjA3MDMxIC02Mi44MzIwMzEgMTUuOTA2MjUgLTYzLjE3MTg3NSAxNy43MTg3NSAtNjMuMTcxODc1IFogTSAxOC4zNDM3NSAtMTMuNjg3NSBMIDU0LjEyNSAtMTMuNjg3NSBMIDU0LjEyNSAtNDkuNDg0Mzc1IEwgMTguMzQzNzUgLTQ5LjQ4NDM3NSBaIE0gMTguMzQzNzUgLTEzLjY4NzUgIi8+PHBhdGggdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjYxLjg5OTAzNyAyMDguMjgyNDEpIiBkPSJNIDU1LjAxNTYyNSAtNjMuMDc4MTI1IEMgNTYuODI4MTI1IC02My4wNzgxMjUgNTguNTE5NTMxIC02Mi43MzgyODEgNjAuMDkzNzUgLTYyLjA2MjUgQyA2MS42NzU3ODEgLTYxLjM5NDUzMSA2My4wNTA3ODEgLTYwLjQ2MDkzOCA2NC4yMTg3NSAtNTkuMjY1NjI1IEMgNjUuMzgyODEyIC01OC4wNjY0MDYgNjYuMzE2NDA2IC01Ni42NzU3ODEgNjcuMDE1NjI1IC01NS4wOTM3NSBDIDY3LjcyMjY1NiAtNTMuNTE5NTMxIDY4LjA3ODEyNSAtNTEuODUxNTYyIDY4LjA3ODEyNSAtNTAuMDkzNzUgTCA2OC4wNzgxMjUgLTMzLjc4MTI1IEMgNjguMDc4MTI1IC0zMi4wMTk1MzEgNjcuNzIyNjU2IC0zMC4zNDc2NTYgNjcuMDE1NjI1IC0yOC43NjU2MjUgQyA2Ni4zMTY0MDYgLTI3LjE5MTQwNiA2NS4zODI4MTIgLTI1LjgwNDY4OCA2NC4yMTg3NSAtMjQuNjA5Mzc1IEMgNjMuMDUwNzgxIC0yMy40MTAxNTYgNjEuNjc1NzgxIC0yMi40NzI2NTYgNjAuMDkzNzUgLTIxLjc5Njg3NSBDIDU4LjUxOTUzMSAtMjEuMTI4OTA2IDU2LjgyODEyNSAtMjAuNzk2ODc1IDU1LjAxNTYyNSAtMjAuNzk2ODc1IEwgMTguNTE1NjI1IC0yMC43MDMxMjUgQyAxOC42OTE0MDYgLTIwLjcwMzEyNSAxOC43ODEyNSAtMjAuNTIzNDM4IDE4Ljc4MTI1IC0yMC4xNzE4NzUgTCAxOC42ODc1IC0yMC4xNzE4NzUgQyAxOC41NzAzMTIgLTIwLjE3MTg3NSAxOC41MTU2MjUgLTIwLjIwMzEyNSAxOC41MTU2MjUgLTIwLjI2NTYyNSBMIDE4LjUxNTYyNSAwIEwgNC45MDYyNSAwIEwgNC45MDYyNSAtNjMuMDc4MTI1IFogTSAxOC41MTU2MjUgLTM0LjQ4NDM3NSBMIDU0LjMxMjUgLTM0LjQ4NDM3NSBMIDU0LjMxMjUgLTQ5LjQ4NDM3NSBMIDE4LjUxNTYyNSAtNDkuNDg0Mzc1IFogTSAxOC41MTU2MjUgLTM0LjQ4NDM3NSAiLz48L2c+CiAgPGcgZmlsbD0iI0ZGN0EwMCIgc3Ryb2tlPSIjRkY3QTAwIj48cGF0aCBkPSJNNzIuNCAxNjQuNCBMOTIuNiAxNzYuNyBMNzIuNCAxODkgWiIgc3Ryb2tlLXdpZHRoPSIyLjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L2c+PC9zdmc+Cg==';
