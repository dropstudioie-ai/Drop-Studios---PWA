// Original starter templates for a dance studio (designed for this app).
// Photos are Drop Studios' own; artwork is original.
import { coverCrop, grad, ic, im, page, r, sh, t, type Template } from './kit';
import { lib } from '../assets/library';
import { makeImage } from '../model/elements';
import { ENGAGEMENT_TEMPLATES, SEASONAL_TEMPLATES } from './seasonal';

const W = '#ffffff', INK = '#0b0f19', LIME = '#c6ff00', ORANGE = '#ff7a00', BLUE = '#1f43e6';

const BASE_TEMPLATES: Template[] = [
  // ───────────── Dance Classes ─────────────
  {
    id: 'hip-hop-poster', name: 'Hip Hop class poster', category: 'Dance Classes', format: 'a4-portrait', tags: ['hip hop', 'class', 'poster', 'urban'],
    pages: () => [page(INK, [
      im('photo-2.webp', 0, 0, 1240, 1050, { fy: 0.45 }),
      r(0, 650, 1240, 420, grad(['rgba(11,15,25,0)', INK], 180)),
      sh('rect', 70, 80, 250, 60, LIME, { cornerRadius: 30 }),
      t('NEW CLASS', 70, 93, 250, 30, { fontFamily: 'Inter', fontWeight: 800, align: 'center', letterSpacing: 4, fill: INK }),
      t('HIP HOP', 60, 930, 1120, 300, { fontFamily: 'Anton', fontWeight: 400, fill: LIME, lineHeight: 0.9 }),
      t('& R&B GROOVES', 70, 1210, 1100, 110, { fontFamily: 'Anton', fontWeight: 400, fill: 'rgba(0,0,0,0)', stroke: { color: W, width: 4 }, lineHeight: 0.9 }),
      t('60 minutes of grooves, bounces and a fresh routine every week. Beginners welcome.', 70, 1395, 760, 34, { fontFamily: 'Inter', fontWeight: 500, fill: '#cbd5e1', lineHeight: 1.35 }),
      r(70, 1540, 1100, 2, '#334155'),
      ic('Calendar', 70, 1585, 54, LIME), t('Wednesdays', 140, 1592, 400, 36, { fontWeight: 700, fill: W }),
      ic('Clock', 560, 1585, 54, LIME), t('7:30 pm', 630, 1592, 260, 36, { fontWeight: 700, fill: W }),
      sh('rect', 900, 1572, 270, 80, LIME, { cornerRadius: 40 }),
      t('BOOK NOW', 900, 1594, 270, 34, { fontWeight: 900, fill: INK, align: 'center', letterSpacing: 2 }),
    ])],
  },
  {
    id: 'heels-poster', name: 'Heels class poster', category: 'Dance Classes', format: 'ig-portrait', tags: ['heels', 'class', 'confidence', 'sensual'],
    pages: () => [page(grad(['#3b0764', '#db2777'], 160), [
      sh('ellipse', 520, -180, 760, 760, 'rgba(255,255,255,0.08)'),
      sh('ellipse', 640, -60, 520, 520, 'rgba(255,255,255,0.08)'),
      t('CONFIDENCE IN EVERY STEP', 70, 90, 800, 30, { fontWeight: 800, letterSpacing: 6, fill: '#f9a8d4' }),
      t('HEELS', 60, 140, 980, 220, { fontFamily: 'Archivo Black', fontWeight: 400, italic: true, fill: W, lineHeight: 0.95 }),
      t('Walks, floor work and a sassy routine. Heels optional for your first class.', 70, 440, 620, 38, { fontWeight: 500, fill: '#fce7f3', lineHeight: 1.3 }),
      im('class-6.webp', 70, 640, 940, 470, { radius: 36, fx: 0.55 }),
      ...[['Timer', '90 min'], ['Sparkles', 'All levels'], ['Music', 'R&B and pop']].flatMap(([icon, label], i) => [
        sh('rect', 70 + i * 320, 1150, 300, 110, 'rgba(255,255,255,0.12)', { cornerRadius: 24 }),
        ic(icon, 100 + i * 320, 1178, 54, '#f9a8d4'),
        t(label, 170 + i * 320, 1186, 190, 34, { fontWeight: 700, fill: W }),
      ]),
    ])],
  },
  {
    id: 'stretch-flex', name: 'Stretch & Flex for dancers', category: 'Dance Classes', format: 'ig-square', tags: ['stretch', 'flexibility', 'splits', 'lines'],
    pages: () => [page('#f4efe6', [
      sh('blob', 560, 120, 600, 600, '#cfe3d4'),
      sh('blob', -140, 640, 520, 520, '#e9d8c4', { rotation: 30 }),
      ic('Sparkles', 80, 90, 80, '#2f6f4f', 1.6),
      t('Stretch\n& Flex', 80, 220, 700, 150, { fontFamily: 'Playfair Display', fontWeight: 700, fill: '#1f3b2d', lineHeight: 1 }),
      t('Work on your splits, kicks and lines. A slow class that helps every dancer move more freely.', 80, 560, 560, 34, { fontFamily: 'DM Sans', fontWeight: 400, fill: '#3f5b4c', lineHeight: 1.45 }),
      r(80, 800, 260, 2, '#1f3b2d'),
      t('SUNDAYS · 10:00', 80, 830, 600, 30, { fontWeight: 700, letterSpacing: 6, fill: '#1f3b2d' }),
      t('50 min · all levels · mats provided', 80, 880, 600, 28, { fontFamily: 'DM Sans', fill: '#3f5b4c' }),
      im('photo-5.webp', 640, 330, 360, 520, { radius: 180, fy: 0.4 }),
    ])],
  },
  {
    id: 'private-lessons', name: 'Private dance lessons', category: 'Dance Classes', format: 'ig-portrait', tags: ['private', 'lessons', '1:1', 'solo', 'coaching'],
    pages: () => [page('#0a0a0a', [
      im('photo-13.webp', 0, 0, 1080, 1350, { fx: 0.35 }),
      r(0, 0, 1080, 1350, grad(['rgba(10,10,10,0.15)', 'rgba(10,10,10,0.95)'], 180)),
      t('1:1', 70, 640, 400, 120, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: '#d4af37' }),
      t('PRIVATE DANCE LESSONS', 70, 760, 940, 110, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, lineHeight: 0.95 }),
      ...['Learn any routine at your own pace', 'Solos, auditions and wedding dances', 'Feedback on every move'].flatMap((s, i) => [
        ic('CircleCheck', 70, 905 + i * 70, 44, '#d4af37'), t(s, 135, 908 + i * 70, 800, 34, { fontWeight: 500, fill: '#e5e5e5' }),
      ]),
      sh('rect', 70, 1150, 520, 100, '#d4af37', { cornerRadius: 12 }),
      t('BOOK A TASTER LESSON', 70, 1184, 520, 32, { fontWeight: 900, fill: '#0a0a0a', align: 'center', letterSpacing: 1 }),
      t('Ask at reception or DM us', 620, 1186, 400, 30, { fontWeight: 500, fill: '#a3a3a3' }),
    ])],
  },
  {
    id: 'open-day', name: 'Studio open day', category: 'Dance Classes', format: 'a4-portrait', tags: ['open day', 'launch', 'announcement', 'free class'],
    pages: () => [page('#ffd60a', [
      sh('rect', -200, 1180, 1700, 260, INK, { rotation: -8 }),
      t('★ ★ ★', 80, 90, 600, 60, { fontWeight: 900, fill: INK, letterSpacing: 10 }),
      t('STUDIO', 70, 170, 1100, 280, { fontFamily: 'Anton', fontWeight: 400, fill: INK, lineHeight: 0.9 }),
      t('OPEN DAY', 70, 420, 1100, 280, { fontFamily: 'Anton', fontWeight: 400, fill: INK, lineHeight: 0.9 }),
      t('Free taster classes all day · meet the instructors · music & drinks', 80, 730, 1080, 40, { fontWeight: 700, fill: INK }),
      im('photo-16.webp', 80, 820, 1080, 400, { radius: 24 }),
      t('SATURDAY 6 JUNE', 90, 1280, 1060, 90, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffd60a', rotation: -8, align: 'center' }),
      t('Drop Studios · 13 Sackville Place, Dublin 1', 80, 1600, 1080, 34, { fontWeight: 700, fill: INK, align: 'center' }),
      t('dropstudios.ie', 80, 1650, 1080, 30, { fontWeight: 500, fill: INK, align: 'center' }),
    ])],
  },
  {
    id: 'dance-challenge', name: '30-day dance challenge', category: 'Dance Classes', format: 'ig-story', tags: ['challenge', '30 day', 'tracker', 'routine'],
    pages: () => [page(grad(['#ff7a00', '#ff2d55'], 160), [
      t('THE', 80, 160, 900, 70, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center' }),
      t('30-DAY', 60, 230, 960, 230, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center', lineHeight: 0.95 }),
      t('DANCE CHALLENGE', 60, 460, 960, 120, { fontFamily: 'Anton', fontWeight: 400, fill: INK, align: 'center' }),
      t('Learn one 8-count a day and tick a box. On day 30 you know the whole routine!', 140, 640, 800, 38, { fontWeight: 600, fill: W, align: 'center', lineHeight: 1.35 }),
      ...Array.from({ length: 30 }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        return [
          sh('rect', 140 + col * 165, 830 + row * 150, 140, 125, 'rgba(255,255,255,0.18)', { cornerRadius: 20 }),
          t(String(i + 1), 140 + col * 165, 862 + row * 150, 140, 52, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center' }),
        ];
      }).flat(),
      t('Post your day-30 video and tag us', 80, 1780, 920, 36, { fontWeight: 800, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'membership-promo', name: 'Dance membership promotion', category: 'Dance Classes', format: 'ig-square', tags: ['membership', 'offer', 'classes', 'join'],
    pages: () => [page(BLUE, [
      im('class-11.webp', 0, 0, 1080, 1080, { opacity: 0.35, grayscale: true }),
      r(0, 0, 1080, 1080, grad(['rgba(31,67,230,0.6)', 'rgba(31,67,230,0.95)'], 180)),
      t('JOIN THIS MONTH', 80, 110, 900, 44, { fontWeight: 800, letterSpacing: 8, fill: '#bfdbfe' }),
      t('Dance every\nweek', 80, 180, 940, 120, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1 }),
      sh('star', 650, 520, 340, 340, ORANGE, { rotation: 12 }),
      t('3 FOR\n€35', 650, 615, 340, 72, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, align: 'center', rotation: 12, lineHeight: 0.95 }),
      t('Intro Offer for new dancers', 80, 500, 520, 46, { fontWeight: 700, fill: W }),
      t('7 dance styles · all levels · Dublin 1', 80, 620, 520, 32, { fontWeight: 500, fill: '#dbeafe' }),
      sh('rect', 80, 880, 380, 96, W, { cornerRadius: 48 }),
      t('Book now →', 80, 906, 380, 40, { fontWeight: 800, fill: BLUE, align: 'center' }),
    ])],
  },
  {
    id: 'timetable', name: 'Class timetable', category: 'Dance Classes', format: 'a4-portrait', tags: ['timetable', 'schedule', 'weekly'],
    pages: () => {
      const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const rows: [string, string, string, string][] = [
        ['MON', '18:00', 'Choreography', '#12b5a2'], ['MON', '19:00', 'Jazz Funk', '#8b5cf6'], ['MON', '20:00', 'Heels', '#e5243b'],
        ['TUE', '18:30', 'FitDance', '#ff7a00'], ['TUE', '19:30', 'Reggaeton', '#e8287a'], ['WED', '18:30', 'FitDance', '#ff7a00'],
        ['WED', '19:30', 'Hip Hop', '#f5b400'], ['THU', '18:30', 'FitDance', '#ff7a00'], ['THU', '19:30', 'Commercial', '#2f5bff'],
        ['FRI', '18:30', 'Afro Beats', '#0ea5e9'], ['SAT', '12:30', 'FitDance', '#ff7a00'], ['SAT', '13:30', 'Commercial', '#2f5bff'],
      ];
      const colW = 180, x0 = 80;
      return [page('#0f172a', [
        t('WEEKLY', 80, 80, 600, 40, { fontWeight: 800, letterSpacing: 10, fill: '#94a3b8' }),
        t('TIMETABLE', 75, 120, 1100, 170, { fontFamily: 'Anton', fontWeight: 400, fill: W }),
        ...days.flatMap((d, i) => [
          sh('rect', x0 + i * colW, 340, colW - 12, 70, '#1e293b', { cornerRadius: 14 }),
          t(d, x0 + i * colW, 358, colW - 12, 32, { fontWeight: 800, fill: W, align: 'center', letterSpacing: 3 }),
        ]),
        ...rows.flatMap(([d, time, name, color]) => {
          const col = days.indexOf(d);
          const n = rows.filter((x) => x[0] === d).findIndex((x) => x[1] === time);
          const y = 440 + n * 230;
          return [
            sh('rect', x0 + col * colW, y, colW - 12, 210, color, { cornerRadius: 16 }),
            t(time, x0 + col * colW + 14, y + 20, colW - 40, 34, { fontWeight: 800, fill: W }),
            t(name, x0 + col * colW + 12, y + 70, colW - 30, Math.min(26, (colW - 30) / (name.length * 0.62)), { fontWeight: 700, fill: W, lineHeight: 1.15 }),
          ];
        }),
        r(80, 1570, 1080, 2, '#334155'),
        t('Book in the app · free cancellation up to 30 min before', 80, 1610, 1080, 30, { fontWeight: 600, fill: '#cbd5e1', align: 'center' }),
      ])];
    },
  },

  // ───────────── Parties & Corporate ─────────────
  {
    id: 'team-building', name: 'Team-building dance workshop', category: 'Parties & Corporate', format: 'a4-portrait', tags: ['corporate', 'team building', 'office', 'workshop', 'company'],
    pages: () => [page('#f8fafc', [
      r(0, 0, 1240, 700, '#1f43e6'),
      sh('ellipse', 820, -160, 600, 600, '#3b5bff'),
      t('TEAM BUILDING', 90, 110, 800, 36, { fontWeight: 800, letterSpacing: 8, fill: '#bfdbfe' }),
      t('Move together.\nLaugh together.', 90, 170, 1000, 110, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.05 }),
      t('A private dance workshop for your team. No experience needed, just good energy.', 90, 460, 800, 38, { fontWeight: 500, fill: '#dbeafe', lineHeight: 1.35 }),
      ...[['Users', 'Any group', 'From 8 to 40 people, at our studio or your office.'], ['Music', 'Pick a style', 'Hip Hop, Commercial, Reggaeton, FitDance…'], ['Video', 'Film it', 'Leave with a video of your team’s routine.']].flatMap(([icon, h, body], i) => [
        sh('rect', 90 + i * 360, 790, 330, 520, W, { cornerRadius: 28, shadow: { color: '#0f172a', blur: 30, offsetX: 0, offsetY: 10, opacity: 0.08 } }),
        sh('ellipse', 120 + i * 360, 830, 110, 110, '#dbeafe'), ic(icon, 145 + i * 360, 855, 60, '#1f43e6'),
        t(h, 120 + i * 360, 980, 280, 40, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t(body, 120 + i * 360, 1040, 270, 28, { fontWeight: 400, fill: '#475569', lineHeight: 1.45 }),
      ]),
      t('Get a quote: hello@dropstudios.ie', 90, 1560, 1060, 32, { fontWeight: 600, fill: '#1f43e6', align: 'center' }),
    ])],
  },
  {
    id: 'hen-party', name: 'Hen party dance class', category: 'Parties & Corporate', format: 'fb-landscape', tags: ['hen party', 'bride', 'bachelorette', 'party', 'celebration'],
    pages: () => [page('#111827', [
      im('class-1.webp', 600, 0, 600, 630),
      r(560, 0, 140, 630, grad(['#111827', 'rgba(17,24,39,0)'], 90)),
      t('HEN PARTIES', 60, 60, 520, 28, { fontWeight: 800, letterSpacing: 6, fill: '#f9a8d4' }),
      t('Dance with\nthe bride!', 60, 105, 540, 70, { fontFamily: 'Playfair Display', fontWeight: 900, fill: W, lineHeight: 1.05 }),
      ...['Learn a routine together', 'Film it for the big day', 'Prosecco toast after'].flatMap((s, i) => [
        ic('Sparkles', 60, 300 + i * 56, 34, '#f9a8d4'), t(s, 108, 304 + i * 56, 480, 26, { fontWeight: 600, fill: '#e5e7eb' }),
      ]),
      sh('rect', 60, 500, 300, 74, '#f9a8d4', { cornerRadius: 37 }), t('Book your party', 60, 522, 300, 28, { fontWeight: 800, fill: '#111827', align: 'center' }),
    ])],
  },
  {
    id: 'lunchtime-dance', name: 'Lunch-break dance class', category: 'Parties & Corporate', format: 'ig-square', tags: ['lunch', 'office', 'express', 'workplace'],
    pages: () => [page('#fff7ed', [
      sh('ellipse', 600, 80, 420, 420, ORANGE), ic('Clock', 690, 170, 240, W, 1.5),
      t('LUNCH BREAK', 80, 120, 520, 40, { fontWeight: 800, letterSpacing: 6, fill: ORANGE }),
      t('GROOVE', 70, 170, 600, 200, { fontFamily: 'Anton', fontWeight: 400, fill: INK }),
      t('A 30-minute dance express. Back at your desk by 1:15 with a smile.', 80, 460, 560, 36, { fontWeight: 500, fill: '#57534e', lineHeight: 1.35 }),
      sh('rect', 80, 640, 920, 2, '#fed7aa'),
      ...[['Calendar', 'Tuesdays & Thursdays'], ['MapPin', 'Drop Studios, Dublin 1'], ['Shirt', 'Come in your work clothes']].flatMap(([icon, s], i) => [
        ic(icon, 80, 690 + i * 90, 48, ORANGE), t(s, 150, 696 + i * 90, 700, 36, { fontWeight: 700, fill: INK }),
      ]),
      t('12:30', 760, 870, 260, 110, { fontFamily: 'Anton', fontWeight: 400, fill: ORANGE, align: 'right' }),
    ])],
  },
  {
    id: 'wedding-dance', name: 'Wedding first dance lessons', category: 'Parties & Corporate', format: 'a4-landscape', tags: ['wedding', 'first dance', 'couples', 'private'],
    pages: () => [page('#fdf8f3', [
      im('photo-9.webp', 1000, 0, 754, 1240, { fy: 0.45 }),
      r(1000, 0, 120, 1240, grad(['#fdf8f3', 'rgba(253,248,243,0)'], 90)),
      t('WEDDINGS', 100, 120, 800, 40, { fontWeight: 800, letterSpacing: 10, fill: '#b45309' }),
      t('Your First\nDance', 95, 180, 900, 150, { fontFamily: 'Playfair Display', fontWeight: 900, fill: '#3b2a1a', lineHeight: 1 }),
      t('Private lessons that turn your first dance into a moment your guests will remember. Any song, any level.', 100, 540, 820, 38, { fontWeight: 400, fill: '#57534e', lineHeight: 1.45 }),
      ...['Pick your song', 'We choreograph it for you', 'Practise until it feels easy'].flatMap((s, i) => [
        sh('ellipse', 100, 770 + i * 90, 56, 56, '#b45309'), t(String(i + 1), 100, 780 + i * 90, 56, 32, { fontWeight: 800, fill: W, align: 'center' }),
        t(s, 180, 780 + i * 90, 700, 36, { fontWeight: 700, fill: '#3b2a1a' }),
      ]),
      sh('rect', 100, 1070, 560, 90, '#3b2a1a', { cornerRadius: 45 }),
      t('Book a free consultation', 100, 1096, 560, 34, { fontWeight: 700, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'dance-it-out', name: 'Dance for wellbeing', category: 'Parties & Corporate', format: 'ig-portrait', tags: ['wellbeing', 'stress', 'mental health', 'feel good'],
    pages: () => [page(grad(['#ede9fe', '#fce7f3'], 160), [
      sh('blob', 520, 120, 520, 520, '#ddd6fe'), sh('blob', 600, 200, 380, 380, '#c4b5fd', { rotation: 50 }),
      ic('Music', 690, 300, 200, '#6d28d9', 1.4),
      t('Dance it\nout.', 80, 260, 600, 130, { fontFamily: 'Playfair Display', fontWeight: 700, fill: '#2e1065', lineHeight: 1.05 }),
      t('Stressful week? An hour of music and movement is the best reset. No judgement, just fun.', 80, 640, 860, 38, { fontFamily: 'DM Sans', fill: '#4c1d95', lineHeight: 1.45 }),
      ...['Beginner friendly', 'Feel-good playlist', 'Make new friends'].flatMap((s, i) => [
        sh('rect', 80, 830 + i * 110, 920, 90, 'rgba(255,255,255,0.7)', { cornerRadius: 45 }),
        ic('Sparkles', 110, 851 + i * 110, 46, '#7c3aed'), t(s, 180, 858 + i * 110, 700, 34, { fontWeight: 700, fill: '#2e1065' }),
      ]),
      t('See you on the dance floor.', 80, 1220, 920, 34, { fontFamily: 'DM Sans', fontWeight: 700, fill: '#6d28d9', align: 'center' }),
    ])],
  },
  {
    id: 'studio-newsletter', name: 'Studio newsletter', category: 'Parties & Corporate', format: 'a4-portrait', tags: ['newsletter', 'news', 'monthly', 'members'],
    pages: () => [
      page(W, [
        r(0, 0, 1240, 260, '#0f172a'),
        t('THE DROP DOWN', 80, 70, 900, 70, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, letterSpacing: 4 }),
        t('Studio newsletter · Issue 12 · Spring', 80, 155, 900, 28, { fontWeight: 500, fill: '#94a3b8' }),
        im('photo-14.webp', 80, 320, 1080, 520, { radius: 20 }),
        t('New classes this season', 80, 890, 1080, 56, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('We’ve added Afro Beats on Fridays, a beginners’ Heels course and a Sunday Stretch & Flex. Book in the app; spaces are capped so the instructors can give everyone attention.', 80, 970, 520, 28, { fontWeight: 400, fill: '#334155', lineHeight: 1.55 }),
        t('Meet the instructor', 640, 970, 520, 36, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('Each month we introduce one of the team. This issue: our Hip Hop lead, dancing for ten years and always up for a freestyle circle.', 640, 1025, 520, 28, { fontWeight: 400, fill: '#334155', lineHeight: 1.55 }),
        r(80, 1460, 1080, 180, '#fff7ed', { cornerRadius: 20 }),
        ic('Ticket', 120, 1505, 90, ORANGE),
        t('Summer Showcase tickets are on sale now!', 240, 1525, 880, 34, { fontWeight: 800, fill: '#9a3412' }),
      ]),
      page(W, [
        t('Your timetable', 80, 90, 1080, 60, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        ...['Mon 20:00 · Heels', 'Tue 19:30 · Reggaeton', 'Wed 19:30 · Hip Hop', 'Thu 19:30 · Commercial', 'Fri 18:30 · Afro Beats'].flatMap((s, i) => [
          r(80, 200 + i * 110, 1080, 90, i % 2 ? '#f8fafc' : '#eef2ff', { cornerRadius: 14 }),
          t(s, 110, 225 + i * 110, 1000, 34, { fontWeight: 600, fill: '#1e293b' }),
        ]),
        t('Song of the month', 80, 820, 1080, 44, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('The track we’re choreographing to this month. Learn it in class and post your video!', 80, 885, 1080, 30, { fontWeight: 400, fill: '#334155', lineHeight: 1.5 }),
        im('illo-headphones', 820, 1050, 340, 340),
      ]),
    ],
  },

  // ───────────── Social Media ─────────────
  {
    id: 'ig-post', name: 'Instagram post: new class alert', category: 'Social Media', format: 'ig-square', tags: ['instagram', 'new class', 'announcement'],
    pages: () => [page(INK, [
      im('class-7.webp', 0, 0, 1080, 1080, { fx: 0.45 }),
      r(0, 560, 1080, 520, grad(['rgba(11,15,25,0)', 'rgba(11,15,25,0.92)'], 180)),
      sh('rect', 60, 60, 330, 70, LIME, { cornerRadius: 35 }), t('NEW CLASS ALERT', 60, 80, 330, 28, { fontWeight: 900, fill: INK, align: 'center', letterSpacing: 2 }),
      t('Afro Beats', 60, 760, 900, 130, { fontFamily: 'Anton', fontWeight: 400, fill: W }),
      t('Fridays 7pm · first class free', 60, 920, 900, 40, { fontWeight: 700, fill: LIME }),
    ])],
  },
  {
    id: 'ig-story', name: 'Instagram story: class playlist', category: 'Social Media', format: 'ig-story', tags: ['instagram', 'story', 'playlist', 'music', 'songs'],
    pages: () => [page('#0b0f19', [
      im('photo-3.webp', 0, 0, 1080, 1920, { opacity: 0.55 }),
      r(0, 0, 1080, 1920, grad(['rgba(11,15,25,0.2)', 'rgba(11,15,25,0.95)'], 180)),
      t('TONIGHT’S', 80, 640, 920, 90, { fontFamily: 'Anton', fontWeight: 400, fill: LIME }),
      t('PLAYLIST', 80, 730, 920, 170, { fontFamily: 'Anton', fontWeight: 400, fill: W }),
      ...['Song title · Artist', 'Song title · Artist', 'Song title · Artist', 'Song title · Artist', 'Song title · Artist'].flatMap((s, i) => [
        t(String(i + 1).padStart(2, '0'), 80, 960 + i * 120, 120, 56, { fontFamily: 'Anton', fontWeight: 400, fill: LIME }),
        t(s, 210, 970 + i * 120, 780, 50, { fontWeight: 800, fill: W }),
      ]),
      t('Which one is your favourite? 🎶', 80, 1640, 920, 40, { fontWeight: 600, fill: '#cbd5e1' }),
    ])],
  },
  {
    id: 'fb-post', name: 'Facebook post: open day', category: 'Social Media', format: 'fb-landscape', tags: ['facebook', 'open day', 'event'],
    pages: () => [page(BLUE, [
      im('photo-14.webp', 600, 0, 600, 630),
      r(560, 0, 140, 630, grad([BLUE, 'rgba(31,67,230,0)'], 90)),
      t('FREE OPEN DAY', 60, 80, 560, 30, { fontWeight: 800, letterSpacing: 6, fill: '#bfdbfe' }),
      t('Try any dance\nclass for free', 60, 130, 560, 70, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.05 }),
      t('Saturday 10am – 4pm · bring a friend', 60, 340, 540, 30, { fontWeight: 600, fill: '#dbeafe' }),
      sh('rect', 60, 450, 300, 80, ORANGE, { cornerRadius: 40 }), t('Save your spot', 60, 474, 300, 30, { fontWeight: 800, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'linkedin', name: 'LinkedIn: corporate dance events', category: 'Social Media', format: 'linkedin', tags: ['linkedin', 'corporate', 'b2b', 'team building'],
    pages: () => [page('#f8fafc', [
      r(0, 0, 14, 627, '#0a66c2'),
      t('CORPORATE DANCE EVENTS', 70, 70, 700, 24, { fontWeight: 800, letterSpacing: 4, fill: '#0a66c2' }),
      t('Teams that dance\ntogether, stay together.', 70, 115, 640, 54, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#0f172a', lineHeight: 1.1 }),
      t('Team-building workshops, office parties and Christmas routines for companies of every size.', 70, 290, 560, 26, { fontWeight: 400, fill: '#475569', lineHeight: 1.45 }),
      ...[['Users', '8–40 people'], ['Music', '7 dance styles'], ['Smile', 'No experience needed']].flatMap(([icon, s], i) => [
        ic(icon, 70 + i * 210, 440, 40, '#0a66c2'), t(s, 70 + i * 210, 495, 200, 22, { fontWeight: 700, fill: '#0f172a' }),
      ]),
      im('photo-9.webp', 760, 60, 380, 507, { radius: 24 }),
    ])],
  },

  // ───────────── Business and Presentations ─────────────
  {
    id: 'presentation', name: 'Presentation cover', category: 'Business and Presentations', format: 'presentation', tags: ['presentation', 'slides', 'deck', 'pitch'],
    pages: () => [
      page('#0f172a', [
        im('photo-16.webp', 960, 0, 960, 1080),
        r(900, 0, 200, 1080, grad(['#0f172a', 'rgba(15,23,42,0)'], 90)),
        t('2027 PLAN', 120, 160, 700, 36, { fontWeight: 800, letterSpacing: 10, fill: '#818cf8' }),
        t('Growing our\ndance family', 115, 230, 820, 130, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.02 }),
        t('Classes, events and partnerships for the year ahead', 120, 560, 720, 38, { fontWeight: 400, fill: '#cbd5e1', lineHeight: 1.4 }),
        r(120, 860, 80, 6, '#818cf8'),
        t('Prepared by the studio team · January', 120, 900, 720, 28, { fontWeight: 600, fill: '#94a3b8' }),
      ]),
      page(W, [
        t('Agenda', 120, 120, 1000, 90, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#0f172a' }),
        ...['Where we are today', 'Members and classes', 'New dance styles', 'Events and showcases', 'Next steps'].flatMap((s, i) => [
          t(String(i + 1).padStart(2, '0'), 120, 290 + i * 130, 140, 64, { fontFamily: 'Anton', fontWeight: 400, fill: '#6366f1' }),
          t(s, 270, 300 + i * 130, 1200, 50, { fontWeight: 700, fill: '#0f172a' }),
        ]),
      ]),
      page('#eef2ff', [
        t('Dancers are up 38%', 120, 120, 1200, 80, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#1e1b4b' }),
        t('Monthly active members, last six months', 120, 220, 1000, 32, { fontWeight: 500, fill: '#4338ca' }),
        ...[120, 160, 190, 230, 270, 330].flatMap((v, i) => [
          sh('rect', 160 + i * 250, 920 - v * 1.8, 160, v * 1.8, i === 5 ? '#6366f1' : '#c7d2fe', { cornerRadius: 16 }),
          t(['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'][i], 160 + i * 250, 950, 160, 30, { fontWeight: 700, fill: '#312e81', align: 'center' }),
        ]),
      ]),
    ],
  },
  {
    id: 'service-promo', name: 'Private studio hire', category: 'Business and Presentations', format: 'ig-portrait', tags: ['studio hire', 'rental', 'rehearsal', 'business'],
    pages: () => [page(W, [
      r(0, 0, 1080, 760, '#111827'),
      im('photo-15.webp', 0, 0, 1080, 760, { opacity: 0.7 }),
      t('STUDIO HIRE', 70, 820, 940, 30, { fontWeight: 800, letterSpacing: 5, fill: '#6366f1' }),
      t('Rehearse, film or host your own class here.', 70, 870, 940, 64, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#111827', lineHeight: 1.1 }),
      t('Sprung floor · mirrors · sound system · city-centre location', 70, 1050, 940, 30, { fontWeight: 500, fill: '#4b5563' }),
      sh('rect', 70, 1160, 420, 96, '#6366f1', { cornerRadius: 48 }), t('Check availability', 70, 1188, 420, 38, { fontWeight: 800, fill: W, align: 'center' }),
      t('hello@dropstudios.ie', 520, 1192, 500, 32, { fontWeight: 600, fill: '#6366f1' }),
    ])],
  },
  {
    id: 'newsletter-banner', name: 'Newsletter banner', category: 'Business and Presentations', format: 'banner', tags: ['banner', 'newsletter', 'email', 'header'],
    pages: () => [page(grad(['#1f43e6', '#7c3aed'], 90), [
      sh('ellipse', 1250, -200, 600, 600, 'rgba(255,255,255,0.1)'),
      t('THE MONTHLY GROOVE', 90, 110, 1000, 110, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, letterSpacing: 6 }),
      t('News, new classes and dancer stories · March edition', 95, 250, 1000, 36, { fontWeight: 500, fill: '#e0e7ff' }),
      im('illo-disco-ball', 1180, 40, 420, 420),
    ])],
  },
  {
    id: 'event-announcement', name: 'Event announcement: showcase', category: 'Business and Presentations', format: 'fb-landscape', tags: ['event', 'showcase', 'performance', 'recital'],
    pages: () => [page('#0b0f19', [
      im('class-14.webp', 0, 0, 1200, 630, { opacity: 0.45 }),
      r(0, 0, 1200, 630, grad(['rgba(11,15,25,0.95)', 'rgba(11,15,25,0.2)'], 90)),
      t('YOU’RE INVITED', 70, 80, 700, 28, { fontWeight: 800, letterSpacing: 8, fill: ORANGE }),
      t('Summer\nShowcase', 65, 120, 700, 110, { fontFamily: 'Anton', fontWeight: 400, fill: W, lineHeight: 1 }),
      t('Every class performs its routine on stage. Bring your family and friends!', 70, 390, 640, 30, { fontWeight: 500, fill: '#e5e7eb' }),
      ic('Calendar', 70, 480, 40, ORANGE), t('Sat 21 June · 7pm', 125, 484, 400, 30, { fontWeight: 800, fill: W }),
      sh('star', 980, 60, 150, 150, ORANGE, { rotation: 10 }), t('FREE', 980, 120, 150, 34, { fontWeight: 900, fill: INK, align: 'center', rotation: 10 }),
    ])],
  },
];

/** Seasonal and engagement templates first: they are the ones used most week to week. */
export const TEMPLATES: Template[] = [...SEASONAL_TEMPLATES, ...ENGAGEMENT_TEMPLATES, ...BASE_TEMPLATES];

// A plain image element helper re-exported for the Drop event generator.
export function photoFrame(src: string, w: number, h: number, x: number, y: number, iw: number, ih: number, radius = 0) {
  return makeImage({ src, x, y, width: w, height: h, crop: coverCrop(iw, ih, w, h), cornerRadius: radius });
}
export { lib };

export const TEMPLATE_CATEGORIES = ['Important Dates', 'High Engagement', 'Dance Classes', 'Parties & Corporate', 'Social Media', 'Business and Presentations'] as const;
