// Original dance-studio templates for the important dates in the Drop calendar, plus post formats that
// typically get the most engagement (giveaways, countdowns, save-worthy carousels, polls,
// testimonials, meet-the-instructor). Laid out for 4:5 feed posts and 9:16 stories.
import type { DesignElement, Fill } from '../model/types';
import { grad, ic, im, page, r, sh, t, type Template } from './kit';

interface Theme {
  id: string; name: string; date: string; headline: string; sub: string; cta: string;
  bg: Fill; panel: string; accent: string; ink: string; soft: string;
  head: string; body: string; icons: string[]; photo: string; layout: 'poster' | 'circle' | 'split' | 'type'; format?: string; tags: string[];
}

const W = 1080, H = 1350;
const SITE = 'dropstudios.ie';

/** Scatter a theme's icons as a light pattern (deterministic, so the template always looks the same). */
function confetti(icons: string[], color: string, area: { x: number; y: number; w: number; h: number }, n = 10, opacity = 0.35): DesignElement[] {
  const out: DesignElement[] = [];
  for (let i = 0; i < n; i++) {
    const s = 50 + ((i * 37) % 60);
    const x = area.x + ((i * 211) % Math.max(1, area.w - s));
    const y = area.y + ((i * 137) % Math.max(1, area.h - s));
    const el = ic(icons[i % icons.length], x, y, s, color, 2);
    el.rotation = (i * 29) % 40 - 20;
    el.opacity = opacity;
    out.push(el);
  }
  return out;
}

/** Black or white, whichever reads better on a colour. */
const onColor = (hex: string) => { const n = parseInt(hex.replace('#', '').slice(0, 6), 16); const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.6 ? '#0b0b0d' : '#ffffff'; };

const headWeight = (f: string) => (['Anton', 'Bebas Neue', 'Archivo Black', 'Permanent Marker', 'Pacifico'].includes(f) ? 400 : 900);
// Average letter width (as a share of the font size) so headlines fit without breaking words.
const CHAR_W: Record<string, number> = { Anton: 0.5, 'Bebas Neue': 0.45, 'Archivo Black': 0.82, 'Permanent Marker': 0.72, 'Playfair Display': 0.6, Pacifico: 0.62 };
const fitSize = (text: string, width: number, max: number, font = 'Anton') => {
  const longest = Math.max(3, ...text.split('\n').map((l) => l.length));
  return Math.min(max, (width / longest) / (CHAR_W[font] ?? 0.62));
};

function poster(th: Theme) {
  const hs = fitSize(th.headline, W - 140, 170, th.head);
  return [page(th.bg, [
    im(th.photo, 0, 0, W, 780, { fy: 0.35 }),
    r(0, 420, W, 380, grad([`${th.panel}00`, th.panel], 180)),
    r(0, 780, W, H - 780, th.panel),
    ...confetti(th.icons, th.accent, { x: 40, y: 820, w: W - 80, h: 470 }, 8, 0.18),
    sh('rect', 70, 70, Math.min(W - 140, th.date.length * 22 + 70), 66, th.accent, { cornerRadius: 33 }),
    t(th.date.toUpperCase(), 70, 89, Math.min(W - 140, th.date.length * 22 + 70), 26, { fontWeight: 900, fill: onColor(th.accent), align: 'center', letterSpacing: 3 }),
    t(th.headline, 70, 700, W - 140, hs, { fontFamily: th.head, fontWeight: headWeight(th.head), fill: th.ink, lineHeight: 0.95 }),
    t(th.sub, 70, 720 + hs * 1.05 * th.headline.split('\n').length, W - 140, 36, { fontFamily: th.body, fontWeight: 500, fill: th.soft, lineHeight: 1.35 }),
    sh('rect', 70, 1190, 360, 92, th.accent, { cornerRadius: 46 }),
    t(th.cta, 70, 1218, 360, 34, { fontFamily: th.body, fontWeight: 800, fill: onColor(th.accent), align: 'center' }),
    t(SITE, 470, 1222, 540, 28, { fontFamily: th.body, fontWeight: 600, fill: th.soft, align: 'right' }),
  ])];
}

function circle(th: Theme) {
  const hs = fitSize(th.headline, W - 160, 140, th.head);
  return [page(th.bg, [
    ...confetti(th.icons, th.accent, { x: 0, y: 0, w: W, h: H }, 14, 0.25),
    t(th.date.toUpperCase(), 80, 90, W - 160, 30, { fontFamily: th.body, fontWeight: 800, letterSpacing: 10, fill: th.accent, align: 'center' }),
    t(th.headline, 80, 140, W - 160, hs, { fontFamily: th.head, fontWeight: headWeight(th.head), fill: th.ink, align: 'center', lineHeight: 0.98 }),
    sh('ellipse', 255, 455, 570, 570, th.accent),
    im(th.photo, 275, 475, 530, 530, { radius: 265, fy: 0.3 }),
    ic(th.icons[0], 760, 440, 130, th.accent, 1.8),
    t(th.sub, 100, 1060, W - 200, 34, { fontFamily: th.body, fontWeight: 500, fill: th.soft, align: 'center', lineHeight: 1.35 }),
    sh('rect', 340, 1200, 400, 88, th.ink, { cornerRadius: 44 }),
    t(th.cta, 340, 1226, 400, 32, { fontFamily: th.body, fontWeight: 800, fill: onColor(th.ink), align: 'center' }),
  ])];
}

function split(th: Theme) {
  const hs = fitSize(th.headline, 450, 120, th.head);
  return [page(th.panel, [
    im(th.photo, 0, 0, 540, H, { fx: 0.5 }),
    r(540, 0, 540, H, th.bg),
    ...confetti(th.icons, th.accent, { x: 560, y: 40, w: 500, h: 400 }, 6, 0.3),
    t(th.date.toUpperCase(), 590, 470, 440, 28, { fontFamily: th.body, fontWeight: 800, letterSpacing: 6, fill: th.accent }),
    t(th.headline, 590, 520, 450, hs, { fontFamily: th.head, fontWeight: headWeight(th.head), fill: th.ink, lineHeight: 1 }),
    t(th.sub, 590, 560 + hs * 1.05 * th.headline.split('\n').length, 430, 32, { fontFamily: th.body, fontWeight: 500, fill: th.soft, lineHeight: 1.4 }),
    sh('rect', 590, 1170, 380, 88, th.accent, { cornerRadius: 44 }),
    t(th.cta, 590, 1196, 380, 32, { fontFamily: th.body, fontWeight: 800, fill: onColor(th.accent), align: 'center' }),
    r(540, 0, 8, H, th.accent),
  ])];
}

function typeLed(th: Theme) {
  const hs = fitSize(th.headline, W - 140, 200, th.head);
  const lines = th.headline.split('\n').length;
  return [page(th.panel, [
    im(th.photo, 0, 0, W, H, { opacity: 0.4 }),
    r(0, 0, W, H, grad([`${th.panel}66`, th.panel], 180)),
    t(th.date.toUpperCase(), 70, 120, W - 140, 32, { fontFamily: th.body, fontWeight: 800, letterSpacing: 10, fill: th.accent }),
    t(th.headline, 76, 196, W - 140, hs, { fontFamily: th.head, fontWeight: headWeight(th.head), fill: 'rgba(0,0,0,0)', stroke: { color: th.accent, width: 4 }, lineHeight: 0.95 }),
    t(th.headline, 70, 186, W - 140, hs, { fontFamily: th.head, fontWeight: headWeight(th.head), fill: th.ink, lineHeight: 0.95 }),
    r(70, 230 + hs * 0.95 * lines, 160, 10, th.accent),
    t(th.sub, 70, 270 + hs * 0.95 * lines, W - 200, 38, { fontFamily: th.body, fontWeight: 500, fill: th.soft, lineHeight: 1.35 }),
    ...th.icons.slice(0, 4).map((n, i) => ic(n, 70 + i * 110, 1110, 74, th.accent, 1.8)),
    sh('rect', 640, 1110, 370, 88, th.accent, { cornerRadius: 44 }),
    t(th.cta, 640, 1136, 370, 32, { fontFamily: th.body, fontWeight: 800, fill: onColor(th.accent), align: 'center' }),
  ])];
}

const LAYOUTS = { poster, circle, split, type: typeLed };

const THEMES: Theme[] = [
  { id: 'new-year', name: 'New Year, new moves', date: '1 January', headline: 'NEW YEAR\nNEW MOVES', sub: 'Start the year dancing. Share your 2027 dance goal and we’ll help you hit it.', cta: 'Book your class', bg: grad(['#0b1026', '#3b1d6e'], 160), panel: '#0b1026', accent: '#fbbf24', ink: '#ffffff', soft: '#e5e7eb', head: 'Anton', body: 'Inter', icons: ['Sparkles', 'Star', 'PartyPopper'], photo: 'photo-6.webp', layout: 'poster', tags: ['january', 'new year', 'resolution', 'goals'] },
  { id: 'st-brigid', name: 'St Brigid’s Day', date: '1 February', headline: 'Here’s to\nIrish women', sub: 'A fresh-start class for St Brigid’s Day, Ireland’s newest bank holiday.', cta: 'Join us', bg: '#f3efe6', panel: '#1f3b2d', accent: '#c2410c', ink: '#1f3b2d', soft: '#3f5b4c', head: 'Playfair Display', body: 'DM Sans', icons: ['Leaf', 'Sun', 'Sparkles'], photo: 'photo-1.webp', layout: 'circle', tags: ['february', 'brigid', 'bank holiday', 'ireland', 'women'] },
  { id: 'valentines', name: 'Valentine’s / Galentine’s', date: '14 February', headline: 'BRING YOUR\nVALENTINE', sub: 'Partner or bestie: grab your person for a love-songs routine. Red and pink encouraged.', cta: 'Book for two', bg: grad(['#be123c', '#fb7185'], 160), panel: '#9f1239', accent: '#ffe4e6', ink: '#ffffff', soft: '#ffe4e6', head: 'Anton', body: 'Inter', icons: ['Heart', 'Sparkles', 'Heart'], photo: 'photo-6.webp', layout: 'split', tags: ['february', 'valentine', 'galentine', 'love', 'couples'] },
  { id: 'mothers-day', name: 'Mother’s Day', date: 'Mother’s Day', headline: 'Bring your\nmum to class', sub: 'Or anyone who’s been a mum to you. She dances free with you this week.', cta: 'Book together', bg: grad(['#fdf2f8', '#fce7f3'], 160), panel: '#831843', accent: '#db2777', ink: '#831843', soft: '#9d174d', head: 'Playfair Display', body: 'DM Sans', icons: ['Flower2', 'Heart', 'Sparkles'], photo: 'photo-1.webp', layout: 'circle', tags: ['march', 'mother', 'mum', 'family'] },
  { id: 'womens-day', name: 'International Women’s Day', date: '8 March', headline: 'STRONG\nTOGETHER', sub: 'An all-female-artists playlist. Wear purple, bring a friend, celebrate each other.', cta: 'Book now', bg: grad(['#4c1d95', '#7c3aed'], 160), panel: '#2e1065', accent: '#f0abfc', ink: '#ffffff', soft: '#ede9fe', head: 'Anton', body: 'Inter', icons: ['Crown', 'Sparkles', 'Heart'], photo: 'photo-6.webp', layout: 'type', tags: ['march', 'women', 'iwd', 'empowerment'] },
  { id: 'st-patricks', name: 'St Patrick’s Day', date: '17 March', headline: 'GO GREEN\nAND DANCE', sub: 'Irish pop hits and a little céilí twist. Wear green (encouraged, never required).', cta: 'Book now', bg: grad(['#14532d', '#16a34a'], 160), panel: '#052e16', accent: '#fde047', ink: '#ffffff', soft: '#dcfce7', head: 'Anton', body: 'Inter', icons: ['Clover', 'Music', 'Sparkles'], photo: 'class-11.webp', layout: 'poster', tags: ['march', 'patrick', 'paddy', 'green', 'irish'] },
  { id: 'easter', name: 'Easter', date: 'Easter weekend', headline: 'Hop into\nEaster', sub: 'Pastel colours, an egg hunt after class and chocolate for everyone.', cta: 'Book your spot', bg: grad(['#fef9c3', '#e0f2fe'], 160), panel: '#1e3a8a', accent: '#f472b6', ink: '#1e3a8a', soft: '#334155', head: 'Pacifico', body: 'DM Sans', icons: ['Egg', 'Rabbit', 'Flower2'], photo: 'photo-8.webp', layout: 'circle', tags: ['april', 'easter', 'pastel', 'spring'] },
  { id: 'dance-day', name: 'International Dance Day', date: '29 April', headline: 'WORLD\nDANCE DAY', sub: 'Open class, bring a friend free, and we film one big group routine.', cta: 'Be in the video', bg: grad(['#ff7a00', '#ff2d55'], 160), panel: '#0b0b0d', accent: '#ffd60a', ink: '#ffffff', soft: '#fff7ed', head: 'Anton', body: 'Inter', icons: ['Music', 'Footprints', 'Sparkles'], photo: 'photo-16.webp', layout: 'type', tags: ['april', 'dance day', 'open class', 'video'] },
  { id: 'eurovision', name: 'Eurovision', date: 'Eurovision week', headline: 'DOUZE\nPOINTS', sub: 'Eurovision anthems, glitter and flags. Pick a country to cheer for.', cta: 'Book now', bg: grad(['#1e1b4b', '#db2777'], 135), panel: '#1e1b4b', accent: '#22d3ee', ink: '#ffffff', soft: '#e0e7ff', head: 'Archivo Black', body: 'Inter', icons: ['Mic', 'Star', 'Flag'], photo: 'photo-7.webp', layout: 'split', tags: ['may', 'eurovision', 'glitter', 'party'] },
  { id: 'pride', name: 'Pride', date: 'Pride Month', headline: 'DANCE WITH\nPRIDE', sub: 'Rainbow dress code and Pride anthems all month, ahead of Dublin Pride.', cta: 'Join the party', bg: grad(['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'], 160), panel: '#111827', accent: '#ffffff', ink: '#ffffff', soft: '#f3f4f6', head: 'Anton', body: 'Inter', icons: ['Heart', 'Sparkles', 'Star'], photo: 'class-6.webp', layout: 'poster', tags: ['june', 'pride', 'rainbow', 'lgbtq'] },
  { id: 'music-day', name: 'World Music Day', date: '21 June', headline: 'LONGEST DAY,\nLOUDEST MUSIC', sub: 'A trip around the world in one class, on the longest day of the year.', cta: 'Book now', bg: grad(['#0e7490', '#22d3ee'], 160), panel: '#083344', accent: '#fde047', ink: '#ffffff', soft: '#cffafe', head: 'Anton', body: 'Inter', icons: ['Music', 'Headphones', 'Sun'], photo: 'photo-3.webp', layout: 'type', tags: ['june', 'music', 'solstice', 'summer'] },
  { id: 'summer-tropical', name: 'Summer Tropical Party', date: 'July', headline: 'TROPICAL\nPARTY', sub: 'Hawaiian shirts, a tropical playlist and fruit after class.', cta: 'Book now', bg: grad(['#f97316', '#facc15'], 160), panel: '#7c2d12', accent: '#0e7490', ink: '#0b0b0d', soft: '#431407', head: 'Archivo Black', body: 'Inter', icons: ['Palmtree', 'Sun', 'IceCreamCone'], photo: 'photo-14.webp', layout: 'circle', tags: ['july', 'summer', 'tropical', 'party'] },
  { id: 'throwback', name: 'Throwback Festival', date: 'August', headline: '90s & 00s\nTHROWBACK', sub: 'Festival glitter and the bangers you grew up with. Dress the decade.', cta: 'Book now', bg: grad(['#0b0221', '#4c1d95'], 160), panel: '#0b0221', accent: '#f0abfc', ink: '#ffffff', soft: '#ede9fe', head: 'Permanent Marker', body: 'Inter', icons: ['Music', 'Glasses', 'Star'], photo: 'photo-12.webp', layout: 'split', tags: ['august', '90s', 'throwback', 'festival', 'retro'] },
  { id: 'back-to-dance', name: 'Back to Dance', date: 'September', headline: 'BACK TO\nDANCE', sub: 'New term, new routine. Set your goals and bring a friend for free.', cta: 'Start this week', bg: '#0b0b0d', panel: '#0b0b0d', accent: '#ffd60a', ink: '#ffffff', soft: '#d4d4d8', head: 'Anton', body: 'Inter', icons: ['Book', 'Target', 'Calendar'], photo: 'photo-11.webp', layout: 'poster', tags: ['september', 'back to school', 'new term', 'routine'] },
  { id: 'halloween', name: 'Halloween', date: '31 October', headline: 'SPOOKY\nSWEAT', sub: 'Costumes, dark lights and a Thriller-inspired routine. Dare you join?', cta: 'Book if you dare', bg: grad(['#0b0b0d', '#3b0764'], 160), panel: '#0b0b0d', accent: '#ff7a00', ink: '#ffffff', soft: '#e5e7eb', head: 'Anton', body: 'Inter', icons: ['Ghost', 'Moon', 'Skull'], photo: 'photo-7.webp', layout: 'type', tags: ['october', 'halloween', 'spooky', 'costume'] },
  { id: 'all-black', name: 'All Black (Black Friday)', date: 'Black Friday', headline: 'ALL\nBLACK', sub: 'Everyone in black, UV lights on, energy up. Our boldest class of the year.', cta: 'Book now', bg: '#050505', panel: '#050505', accent: '#c6ff00', ink: '#ffffff', soft: '#d4d4d4', head: 'Anton', body: 'Inter', icons: ['Zap', 'Flame', 'Star'], photo: 'photo-2.webp', layout: 'poster', tags: ['november', 'black friday', 'all black', 'uv'] },
  { id: 'christmas', name: 'Christmas', date: 'Christmas', headline: 'Jingle\nall the way', sub: 'Christmas jumpers, festive hits and mince pies after class.', cta: 'Book your spot', bg: grad(['#7f1d1d', '#991b1b'], 160), panel: '#14532d', accent: '#fbbf24', ink: '#ffffff', soft: '#fee2e2', head: 'Playfair Display', body: 'Inter', icons: ['TreePine', 'Gift', 'Snowflake'], photo: 'class-11.webp', layout: 'circle', tags: ['december', 'christmas', 'festive', 'xmas'] },
  { id: 'nye', name: 'New Year’s Eve', date: '31 December', headline: 'COUNTDOWN\nTO 2027', sub: 'Glitter, gold and a countdown routine to close the year in style.', cta: 'Book now', bg: grad(['#0b0b0d', '#27272a'], 160), panel: '#0b0b0d', accent: '#d4af37', ink: '#ffffff', soft: '#e7e5e4', head: 'Anton', body: 'Inter', icons: ['Sparkles', 'PartyPopper', 'Star'], photo: 'photo-16.webp', layout: 'type', tags: ['december', 'new years eve', 'nye', 'countdown', 'glitter'] },
];

export const SEASONAL_TEMPLATES: Template[] = THEMES.map((th) => ({
  id: `date-${th.id}`, name: th.name, category: 'Important Dates', format: th.format ?? 'ig-portrait',
  tags: [...th.tags, th.date.toLowerCase(), 'seasonal', 'holiday'], pages: () => LAYOUTS[th.layout](th),
}));

// ───────── High-engagement formats ─────────
const INK = '#0b0b0d', LIME = '#c6ff00', BLUE = '#1f43e6', ORANGE = '#ff7a00';

export const ENGAGEMENT_TEMPLATES: Template[] = [
  {
    id: 'eng-giveaway', name: 'Giveaway: tag a friend', category: 'High Engagement', format: 'ig-portrait', tags: ['giveaway', 'contest', 'tag a friend', 'win', 'free'],
    pages: () => [page(grad([BLUE, '#7c3aed'], 160), [
      ...confetti(['Gift', 'Sparkles', 'Star'], '#ffffff', { x: 0, y: 0, w: W, h: 520 }, 10, 0.18),
      t('GIVEAWAY', 70, 80, W - 140, 40, { fontWeight: 900, letterSpacing: 14, fill: LIME, align: 'center' }),
      t('WIN A MONTH\nOF CLASSES', 70, 140, W - 140, 130, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffffff', align: 'center', lineHeight: 0.95 }),
      t('…and one for a friend!', 70, 420, W - 140, 40, { fontFamily: 'Permanent Marker', fontWeight: 400, fill: LIME, align: 'center' }),
      ...[['Heart', 'Like this post'], ['UserPlus', 'Follow us'], ['AtSign', 'Tag the friend you’d bring']].flatMap(([icon, s], i) => [
        sh('rect', 120, 560 + i * 170, W - 240, 140, 'rgba(255,255,255,0.12)', { cornerRadius: 28 }),
        sh('ellipse', 150, 590 + i * 170, 80, 80, LIME), t(String(i + 1), 150, 606 + i * 170, 80, 44, { fontFamily: 'Anton', fontWeight: 400, fill: INK, align: 'center' }),
        ic(icon, 260, 597 + i * 170, 66, '#ffffff'), t(s, 350, 607 + i * 170, 600, 40, { fontWeight: 800, fill: '#ffffff' }),
      ]),
      t('Winner announced Friday · Ireland only · good luck!', 70, 1150, W - 140, 30, { fontWeight: 600, fill: '#e0e7ff', align: 'center' }),
      t(SITE, 70, 1220, W - 140, 30, { fontWeight: 800, fill: '#ffffff', align: 'center' }),
    ])],
  },
  {
    id: 'eng-countdown', name: 'Countdown story: days to go', category: 'High Engagement', format: 'ig-story', tags: ['countdown', 'story', 'days to go', 'launch', 'event'],
    pages: () => [page(INK, [
      im('photo-6.webp', 0, 0, 1080, 1920, { opacity: 0.35 }),
      r(0, 0, 1080, 1920, grad(['rgba(11,11,13,0.2)', 'rgba(11,11,13,0.95)'], 180)),
      t('ONLY', 80, 560, 920, 80, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffffff', align: 'center' }),
      t('3', 80, 620, 920, 520, { fontFamily: 'Anton', fontWeight: 400, fill: ORANGE, align: 'center', lineHeight: 0.9 }),
      t('DAYS TO GO', 80, 1110, 920, 120, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffffff', align: 'center' }),
      t('until our Neon Night class. Spots are filling up!', 140, 1270, 800, 44, { fontWeight: 600, fill: '#e5e7eb', align: 'center', lineHeight: 1.3 }),
      sh('rect', 290, 1480, 500, 110, '#ffffff', { cornerRadius: 55 }), t('Tap to book ↗', 290, 1514, 500, 42, { fontWeight: 900, fill: INK, align: 'center' }),
    ])],
  },
  {
    id: 'eng-carousel', name: 'Save this warm-up (carousel)', category: 'High Engagement', format: 'ig-portrait', tags: ['carousel', 'save', 'warm-up', 'tips', 'swipe'],
    pages: () => [
      page(LIME, [
        t('SAVE THIS 🔖', 70, 80, 600, 40, { fontWeight: 900, letterSpacing: 4, fill: INK }),
        t('5-MINUTE\nWARM-UP\nBEFORE\nANY CLASS', 60, 170, 960, 170, { fontFamily: 'Anton', fontWeight: 400, fill: INK, lineHeight: 0.92 }),
        t('Swipe →', 70, 1200, 940, 50, { fontWeight: 900, fill: INK, align: 'right' }),
        im('photo-3.webp', 620, 820, 400, 330, { radius: 30 }),
      ]),
      page('#ffffff', [
        t('THE MOVES', 70, 80, 900, 44, { fontWeight: 900, letterSpacing: 6, fill: BLUE }),
        ...['Neck rolls · 30s', 'Shoulder circles · 30s', 'Hip circles · 45s', 'Leg swings · 30s each', 'Light bounce + arms · 60s'].flatMap((s, i) => [
          t(String(i + 1).padStart(2, '0'), 70, 200 + i * 200, 160, 110, { fontFamily: 'Anton', fontWeight: 400, fill: LIME, stroke: { color: INK, width: 3 } }),
          t(s, 240, 230 + i * 200, 760, 52, { fontWeight: 800, fill: INK }),
        ]),
      ]),
      page(INK, [
        t('Found this useful?', 70, 380, 940, 70, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#ffffff', align: 'center' }),
        ...[['Bookmark', 'Save it'], ['Share2', 'Send to a friend'], ['Calendar', 'Book a class']].flatMap(([icon, s], i) => [
          ic(icon, 150 + i * 290, 560, 110, LIME), t(s, 90 + i * 290, 700, 230, 34, { fontWeight: 800, fill: '#ffffff', align: 'center' }),
        ]),
        t(SITE, 70, 1150, 940, 34, { fontWeight: 800, fill: LIME, align: 'center' }),
      ]),
    ],
  },
  {
    id: 'eng-this-or-that', name: 'This or That story', category: 'High Engagement', format: 'ig-story', tags: ['this or that', 'poll', 'story', 'interactive', 'quiz'],
    pages: () => [page('#ffffff', [
      t('THIS OR THAT?', 60, 140, 960, 110, { fontFamily: 'Anton', fontWeight: 400, fill: INK, align: 'center' }),
      t('Vote with the poll sticker 👇', 60, 270, 960, 40, { fontWeight: 600, fill: '#475569', align: 'center' }),
      ...[['Morning class', 'Evening class'], ['Hip Hop', 'Heels'], ['Front row', 'Back row'], ['Pop hits', 'Throwbacks']].flatMap(([a, b], i) => [
        sh('rect', 70, 400 + i * 330, 440, 270, i % 2 ? ORANGE : BLUE, { cornerRadius: 36 }), t(a, 90, 500 + i * 330, 400, 52, { fontWeight: 900, fill: '#ffffff', align: 'center' }),
        sh('ellipse', 480, 480 + i * 330, 120, 120, INK), t('OR', 480, 514 + i * 330, 120, 44, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffffff', align: 'center' }),
        sh('rect', 570, 400 + i * 330, 440, 270, i % 2 ? BLUE : ORANGE, { cornerRadius: 36 }), t(b, 590, 500 + i * 330, 400, 52, { fontWeight: 900, fill: '#ffffff', align: 'center' }),
      ]),
    ])],
  },
  {
    id: 'eng-testimonial', name: 'Member quote', category: 'High Engagement', format: 'ig-square', tags: ['testimonial', 'review', 'quote', 'member', 'social proof'],
    pages: () => [page('#f5f5f4', [
      t('“', 60, -40, 400, 420, { fontFamily: 'Playfair Display', fontWeight: 900, fill: ORANGE }),
      t('I came for one class and stayed for the people. Best part of my week!', 90, 260, 900, 66, { fontFamily: 'Playfair Display', fontWeight: 700, fill: INK, lineHeight: 1.2 }),
      ...[0, 1, 2, 3, 4].map((i) => ic('Star', 90 + i * 70, 640, 56, ORANGE, 2.2)),
      im('class-1.webp', 90, 760, 170, 170, { radius: 85 }),
      t('Aoife, member since 2025', 290, 810, 700, 40, { fontWeight: 800, fill: INK }),
      t('FitDance & Heels', 290, 860, 700, 30, { fontWeight: 500, fill: '#57534e' }),
    ])],
  },
  {
    id: 'eng-meet-instructor', name: 'Meet the instructor', category: 'High Engagement', format: 'ig-portrait', tags: ['instructor', 'meet the team', 'coach', 'introduction', 'behind the scenes'],
    pages: () => [page(INK, [
      im('photo-13.webp', 0, 0, W, 860, { fx: 0.35 }),
      r(0, 600, W, 260, grad(['rgba(11,11,13,0)', INK], 180)),
      t('MEET YOUR INSTRUCTOR', 70, 820, W - 140, 32, { fontWeight: 900, letterSpacing: 6, fill: LIME }),
      t('Name Surname', 70, 870, W - 140, 100, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffffff' }),
      ...[['Music', 'Teaches FitDance & Commercial'], ['Trophy', '10 years dancing'], ['Heart', 'Favourite song: your pick!']].flatMap(([icon, s], i) => [
        ic(icon, 70, 1010 + i * 80, 48, LIME), t(s, 140, 1016 + i * 80, 860, 36, { fontWeight: 600, fill: '#e5e7eb' }),
      ]),
    ])],
  },
];
