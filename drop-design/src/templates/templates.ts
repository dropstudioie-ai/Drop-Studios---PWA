// Original starter templates (designed for this app). Photos are the studio's own; artwork is original.
import { coverCrop, grad, ic, im, page, r, sh, t, type Template } from './kit';
import { lib } from '../assets/library';
import { makeImage } from '../model/elements';

const W = '#ffffff', INK = '#0b0f19', LIME = '#c6ff00', ORANGE = '#ff7a00', BLUE = '#1f43e6';

export const TEMPLATES: Template[] = [
  // ───────────── Fitness and Gym ─────────────
  {
    id: 'hiit-core', name: 'HIIT & Core class poster', category: 'Fitness and Gym', format: 'a4-portrait', tags: ['hiit', 'core', 'class', 'poster'],
    pages: () => [page(INK, [
      im('photo-2.webp', 0, 0, 1240, 1050, { fy: 0.45 }),
      r(0, 650, 1240, 420, grad(['rgba(11,15,25,0)', INK], 180)),
      sh('rect', 70, 80, 250, 60, LIME, { cornerRadius: 30 }),
      t('NEW CLASS', 70, 93, 250, 30, { fontFamily: 'Inter', fontWeight: 800, align: 'center', letterSpacing: 4, fill: INK }),
      t('HIIT', 60, 930, 1120, 300, { fontFamily: 'Anton', fontWeight: 400, fill: LIME, lineHeight: 0.9 }),
      t('& CORE', 70, 1210, 1100, 150, { fontFamily: 'Anton', fontWeight: 400, fill: 'rgba(0,0,0,0)', stroke: { color: W, width: 4 }, lineHeight: 0.9 }),
      t('45 minutes of intervals, then a core finisher. All levels, every rep can be scaled.', 70, 1395, 760, 34, { fontFamily: 'Inter', fontWeight: 500, fill: '#cbd5e1', lineHeight: 1.35 }),
      r(70, 1540, 1100, 2, '#334155'),
      ic('Calendar', 70, 1585, 54, LIME), t('Mon · Wed · Fri', 140, 1592, 400, 36, { fontWeight: 700, fill: W }),
      ic('Clock', 560, 1585, 54, LIME), t('7:00 am', 630, 1592, 260, 36, { fontWeight: 700, fill: W }),
      sh('rect', 900, 1572, 270, 80, LIME, { cornerRadius: 40 }),
      t('BOOK NOW', 900, 1594, 270, 34, { fontWeight: 900, fill: INK, align: 'center', letterSpacing: 2 }),
    ])],
  },
  {
    id: 'spin', name: 'Spin class poster', category: 'Fitness and Gym', format: 'ig-portrait', tags: ['spin', 'cycling', 'class'],
    pages: () => [page(grad(['#3b0764', '#db2777'], 160), [
      sh('ellipse', 520, -180, 760, 760, 'rgba(255,255,255,0.08)'),
      sh('ellipse', 640, -60, 520, 520, 'rgba(255,255,255,0.08)'),
      t('RIDE THE BEAT', 70, 90, 600, 30, { fontWeight: 800, letterSpacing: 8, fill: '#f9a8d4' }),
      t('SPIN', 60, 130, 900, 300, { fontFamily: 'Archivo Black', fontWeight: 400, italic: true, fill: W, lineHeight: 0.95 }),
      t('45-minute rhythm ride with lights down and the music up.', 70, 450, 620, 38, { fontWeight: 500, fill: '#fce7f3', lineHeight: 1.3 }),
      im('class-6.webp', 70, 640, 940, 470, { radius: 36, fx: 0.55 }),
      ...[['Timer', '45 min'], ['Flame', '500+ kcal'], ['Music', 'Live DJ set']].flatMap(([icon, label], i) => [
        sh('rect', 70 + i * 320, 1150, 300, 110, 'rgba(255,255,255,0.12)', { cornerRadius: 24 }),
        ic(icon, 100 + i * 320, 1178, 54, '#f9a8d4'),
        t(label, 170 + i * 320, 1186, 190, 34, { fontWeight: 700, fill: W }),
      ]),
    ])],
  },
  {
    id: 'stretch-reset', name: 'Stretch & Reset', category: 'Fitness and Gym', format: 'ig-square', tags: ['stretch', 'mobility', 'yoga', 'recovery'],
    pages: () => [page('#f4efe6', [
      sh('blob', 560, 120, 600, 600, '#cfe3d4'),
      sh('blob', -140, 640, 520, 520, '#e9d8c4', { rotation: 30 }),
      ic('Leaf', 80, 90, 80, '#2f6f4f', 1.6),
      t('Stretch\n& Reset', 80, 220, 700, 150, { fontFamily: 'Playfair Display', fontWeight: 700, fill: '#1f3b2d', lineHeight: 1 }),
      t('A slow, feel-good session to release tight hips, shoulders and backs. Bring your breath; we’ll do the rest.', 80, 560, 560, 34, { fontFamily: 'DM Sans', fontWeight: 400, fill: '#3f5b4c', lineHeight: 1.45 }),
      r(80, 800, 260, 2, '#1f3b2d'),
      t('SUNDAYS · 10:00', 80, 830, 600, 30, { fontWeight: 700, letterSpacing: 6, fill: '#1f3b2d' }),
      t('50 min · all levels · mats provided', 80, 880, 600, 28, { fontFamily: 'DM Sans', fill: '#3f5b4c' }),
      im('photo-5.webp', 640, 330, 360, 520, { radius: 180, fy: 0.4 }),
    ])],
  },
  {
    id: 'personal-training', name: 'Personal training promotion', category: 'Fitness and Gym', format: 'ig-portrait', tags: ['personal training', 'pt', 'coach', '1:1'],
    pages: () => [page('#0a0a0a', [
      im('photo-13.webp', 0, 0, 1080, 1350, { fx: 0.35 }),
      r(0, 0, 1080, 1350, grad(['rgba(10,10,10,0.15)', 'rgba(10,10,10,0.95)'], 180)),
      t('1:1', 70, 640, 400, 120, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: '#d4af37' }),
      t('PERSONAL TRAINING', 70, 760, 940, 110, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, lineHeight: 0.95 }),
      ...['A plan built around your goals', 'Form coaching every session', 'Nutrition and habit check-ins'].flatMap((s, i) => [
        ic('CircleCheck', 70, 905 + i * 70, 44, '#d4af37'), t(s, 135, 908 + i * 70, 800, 34, { fontWeight: 500, fill: '#e5e5e5' }),
      ]),
      sh('rect', 70, 1150, 520, 100, '#d4af37', { cornerRadius: 12 }),
      t('FIRST SESSION FREE', 70, 1180, 520, 40, { fontWeight: 900, fill: '#0a0a0a', align: 'center', letterSpacing: 2 }),
      t('Book a chat with a coach', 620, 1186, 400, 30, { fontWeight: 500, fill: '#a3a3a3' }),
    ])],
  },
  {
    id: 'gym-opening', name: 'Gym opening announcement', category: 'Fitness and Gym', format: 'a4-portrait', tags: ['opening', 'launch', 'announcement'],
    pages: () => [page('#ffd60a', [
      sh('rect', -200, 1180, 1700, 260, INK, { rotation: -8 }),
      t('★ ★ ★', 80, 90, 600, 60, { fontWeight: 900, fill: INK, letterSpacing: 10 }),
      t('GRAND', 70, 170, 1100, 280, { fontFamily: 'Anton', fontWeight: 400, fill: INK, lineHeight: 0.9 }),
      t('OPENING', 70, 420, 1100, 280, { fontFamily: 'Anton', fontWeight: 400, fill: INK, lineHeight: 0.9 }),
      t('Free classes all weekend · tours · prizes · smoothies', 80, 730, 1000, 40, { fontWeight: 700, fill: INK }),
      im('photo-16.webp', 80, 820, 1080, 400, { radius: 24 }),
      t('SAT 6 – SUN 7 JUNE', 90, 1280, 1060, 90, { fontFamily: 'Anton', fontWeight: 400, fill: '#ffd60a', rotation: -8, align: 'center' }),
      t('Your Studio Name · 1 Main Street', 80, 1600, 1080, 34, { fontWeight: 700, fill: INK, align: 'center' }),
      t('yourstudio.com', 80, 1650, 1080, 30, { fontWeight: 500, fill: INK, align: 'center' }),
    ])],
  },
  {
    id: 'fitness-challenge', name: '30-day fitness challenge', category: 'Fitness and Gym', format: 'ig-story', tags: ['challenge', '30 day', 'tracker'],
    pages: () => [page(grad(['#ff7a00', '#ff2d55'], 160), [
      t('THE', 80, 160, 900, 70, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center' }),
      t('30-DAY', 60, 230, 960, 230, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center', lineHeight: 0.95 }),
      t('CHALLENGE', 60, 460, 960, 130, { fontFamily: 'Anton', fontWeight: 400, fill: INK, align: 'center' }),
      t('One class a day. Tick a box each time. Finish all 30 and win a free month.', 140, 640, 800, 38, { fontWeight: 600, fill: W, align: 'center', lineHeight: 1.35 }),
      ...Array.from({ length: 30 }, (_, i) => {
        const col = i % 5, row = Math.floor(i / 5);
        return [
          sh('rect', 140 + col * 165, 830 + row * 150, 140, 125, 'rgba(255,255,255,0.18)', { cornerRadius: 20 }),
          t(String(i + 1), 140 + col * 165, 862 + row * 150, 140, 52, { fontFamily: 'Anton', fontWeight: 400, fill: W, align: 'center' }),
        ];
      }).flat(),
      t('Starts Monday · sign up at reception', 80, 1780, 920, 36, { fontWeight: 800, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'membership-promo', name: 'Gym membership promotion', category: 'Fitness and Gym', format: 'ig-square', tags: ['membership', 'offer', 'sale', 'discount'],
    pages: () => [page(BLUE, [
      im('class-11.webp', 0, 0, 1080, 1080, { opacity: 0.35, grayscale: true }),
      r(0, 0, 1080, 1080, grad(['rgba(31,67,230,0.6)', 'rgba(31,67,230,0.95)'], 180)),
      t('JOIN THIS MONTH', 80, 110, 900, 44, { fontWeight: 800, letterSpacing: 8, fill: '#bfdbfe' }),
      t('Unlimited\nclasses', 80, 180, 900, 150, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1 }),
      sh('star', 650, 520, 340, 340, ORANGE, { rotation: 12 }),
      t('20%\nOFF', 650, 615, 340, 72, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, align: 'center', rotation: 12, lineHeight: 0.95 }),
      t('your first 3 months', 80, 560, 520, 46, { fontWeight: 700, fill: W }),
      t('No joining fee · cancel any time', 80, 630, 520, 32, { fontWeight: 500, fill: '#dbeafe' }),
      sh('rect', 80, 880, 380, 96, W, { cornerRadius: 48 }),
      t('Join now →', 80, 906, 380, 40, { fontWeight: 800, fill: BLUE, align: 'center' }),
    ])],
  },
  {
    id: 'timetable', name: 'Class timetable', category: 'Fitness and Gym', format: 'a4-portrait', tags: ['timetable', 'schedule', 'weekly'],
    pages: () => {
      const days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const rows: [string, string, string, string][] = [
        ['MON', '18:00', 'Choreography', '#12b5a2'], ['MON', '19:00', 'Jazz Funk', '#8b5cf6'], ['MON', '20:00', 'Heels', '#e5243b'],
        ['TUE', '18:30', 'FitDance', '#ff7a00'], ['TUE', '19:30', 'Reggaeton', '#e8287a'], ['WED', '18:30', 'FitDance', '#ff7a00'],
        ['WED', '19:30', 'Hip Hop', '#f5b400'], ['THU', '18:30', 'FitDance', '#ff7a00'], ['THU', '19:30', 'Commercial', '#2f5bff'],
        ['FRI', '18:30', 'HIIT & Core', '#0ea5e9'], ['SAT', '12:30', 'FitDance', '#ff7a00'], ['SAT', '13:30', 'Commercial', '#2f5bff'],
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
            t(name, x0 + col * colW + 14, y + 70, colW - 40, 28, { fontWeight: 700, fill: W, lineHeight: 1.15 }),
          ];
        }),
        r(80, 1570, 1080, 2, '#334155'),
        t('Book in the app · free cancellation up to 30 min before', 80, 1610, 1080, 30, { fontWeight: 600, fill: '#cbd5e1', align: 'center' }),
      ])];
    },
  },

  // ───────────── Corporate Wellness ─────────────
  {
    id: 'workplace-wellness', name: 'Workplace wellness campaign', category: 'Corporate Wellness', format: 'a4-portrait', tags: ['wellness', 'workplace', 'campaign', 'office'],
    pages: () => [page('#f8fafc', [
      r(0, 0, 1240, 700, '#0f766e'),
      sh('ellipse', 820, -160, 600, 600, '#14b8a6'),
      t('WELLNESS WEEK', 90, 110, 800, 36, { fontWeight: 800, letterSpacing: 8, fill: '#99f6e4' }),
      t('Move more.\nStress less.', 90, 170, 900, 120, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.05 }),
      t('Small daily habits that make work feel better: join in from 3–7 March.', 90, 460, 760, 38, { fontWeight: 500, fill: '#ccfbf1', lineHeight: 1.35 }),
      ...[['Footprints', 'Walk & talk', 'Take your 1:1s outside. 20-minute loops from reception.'], ['Dumbbell', 'Desk-to-gym', 'Free lunchtime classes in the studio all week.'], ['Brain', 'Headspace', 'Guided 10-minute calm sessions at 3pm.']].flatMap(([icon, h, body], i) => [
        sh('rect', 90 + i * 360, 790, 330, 520, W, { cornerRadius: 28, shadow: { color: '#0f172a', blur: 30, offsetX: 0, offsetY: 10, opacity: 0.08 } }),
        sh('ellipse', 120 + i * 360, 830, 110, 110, '#ccfbf1'), ic(icon, 145 + i * 360, 855, 60, '#0f766e'),
        t(h, 120 + i * 360, 980, 280, 40, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t(body, 120 + i * 360, 1040, 270, 28, { fontWeight: 400, fill: '#475569', lineHeight: 1.45 }),
      ]),
      t('Questions? wellbeing@yourcompany.com', 90, 1560, 1060, 32, { fontWeight: 600, fill: '#0f766e', align: 'center' }),
    ])],
  },
  {
    id: 'employee-challenge', name: 'Employee fitness challenge', category: 'Corporate Wellness', format: 'linkedin', tags: ['steps', 'challenge', 'team', 'employees'],
    pages: () => [page('#111827', [
      t('TEAM STEP CHALLENGE', 60, 60, 700, 30, { fontWeight: 800, letterSpacing: 6, fill: '#34d399' }),
      t('10,000 steps.\nEvery day.\nFour weeks.', 60, 110, 620, 66, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.08 }),
      t('Form a team of five and climb the leaderboard. Weekly prizes.', 60, 400, 560, 26, { fontWeight: 500, fill: '#9ca3af', lineHeight: 1.4 }),
      ...[['Marketing', 0.92], ['Engineering', 0.78], ['Finance', 0.64], ['Sales', 0.5]].flatMap(([team, v], i) => [
        t(String(team), 700, 120 + i * 105, 200, 24, { fontWeight: 700, fill: '#e5e7eb' }),
        sh('rect', 700, 155 + i * 105, 440, 28, '#1f2937', { cornerRadius: 14 }),
        sh('rect', 700, 155 + i * 105, 440 * Number(v), 28, grad(['#10b981', '#34d399'], 90), { cornerRadius: 14 }),
      ]),
      ic('Trophy', 1080, 40, 70, '#fbbf24'),
    ])],
  },
  {
    id: 'lunchtime-class', name: 'Lunch-time fitness class', category: 'Corporate Wellness', format: 'ig-square', tags: ['lunch', 'office', 'class', 'express'],
    pages: () => [page('#fff7ed', [
      sh('ellipse', 600, 80, 420, 420, ORANGE), ic('Clock', 690, 170, 240, W, 1.5),
      t('LUNCH BREAK', 80, 120, 520, 40, { fontWeight: 800, letterSpacing: 6, fill: ORANGE }),
      t('BURN', 70, 170, 600, 220, { fontFamily: 'Anton', fontWeight: 400, fill: INK }),
      t('30-minute express workout. Back at your desk by 1:15, fully energised.', 80, 460, 560, 36, { fontWeight: 500, fill: '#57534e', lineHeight: 1.35 }),
      sh('rect', 80, 640, 920, 2, '#fed7aa'),
      ...[['Calendar', 'Tue & Thu'], ['MapPin', 'Studio 2, Ground floor'], ['Shirt', 'Showers & towels available']].flatMap(([icon, s], i) => [
        ic(icon, 80, 690 + i * 90, 48, ORANGE), t(s, 150, 696 + i * 90, 700, 36, { fontWeight: 700, fill: INK }),
      ]),
      t('12:30', 760, 870, 260, 110, { fontFamily: 'Anton', fontWeight: 400, fill: ORANGE, align: 'right' }),
    ])],
  },
  {
    id: 'mobility-workshop', name: 'Movement & mobility workshop', category: 'Corporate Wellness', format: 'a4-landscape', tags: ['workshop', 'mobility', 'posture', 'movement'],
    pages: () => [page('#eef2ff', [
      im('photo-5.webp', 1000, 0, 754, 1240, { fy: 0.45 }),
      r(1000, 0, 120, 1240, grad(['#eef2ff', 'rgba(238,242,255,0)'], 90)),
      t('WORKSHOP', 100, 120, 800, 40, { fontWeight: 800, letterSpacing: 10, fill: '#4f46e5' }),
      t('Movement &\nMobility', 95, 180, 900, 150, { fontFamily: 'Playfair Display', fontWeight: 900, fill: '#1e1b4b', lineHeight: 1 }),
      t('A practical 90-minute session on posture, desk breaks and simple routines that undo a day of sitting.', 100, 540, 820, 38, { fontWeight: 400, fill: '#3730a3', lineHeight: 1.45 }),
      ...['Spot your posture habits', 'Five-minute desk resets', 'Take-home mobility plan'].flatMap((s, i) => [
        sh('ellipse', 100, 770 + i * 90, 56, 56, '#4f46e5'), t(String(i + 1), 100, 780 + i * 90, 56, 32, { fontWeight: 800, fill: W, align: 'center' }),
        t(s, 180, 780 + i * 90, 700, 36, { fontWeight: 700, fill: '#1e1b4b' }),
      ]),
      sh('rect', 100, 1070, 520, 90, '#1e1b4b', { cornerRadius: 45 }),
      t('Thursday 14 May · 2pm', 100, 1096, 520, 34, { fontWeight: 700, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'mental-wellbeing', name: 'Mental wellbeing campaign', category: 'Corporate Wellness', format: 'ig-portrait', tags: ['mental health', 'wellbeing', 'mindfulness', 'calm'],
    pages: () => [page(grad(['#ede9fe', '#fce7f3'], 160), [
      sh('blob', 520, 120, 520, 520, '#ddd6fe'), sh('blob', 600, 200, 380, 380, '#c4b5fd', { rotation: 50 }),
      ic('Heart', 690, 300, 200, '#6d28d9', 1.4),
      t('It’s OK\nto pause.', 80, 260, 600, 120, { fontFamily: 'Playfair Display', fontWeight: 700, fill: '#2e1065', lineHeight: 1.05 }),
      t('This month we’re making space for mental wellbeing: talks, quiet rooms and confidential support for everyone.', 80, 620, 860, 38, { fontFamily: 'DM Sans', fill: '#4c1d95', lineHeight: 1.45 }),
      ...['Quiet room open daily', 'Free counselling line', 'Lunchtime breathwork'].flatMap((s, i) => [
        sh('rect', 80, 830 + i * 110, 920, 90, 'rgba(255,255,255,0.7)', { cornerRadius: 45 }),
        ic('Sparkles', 110, 851 + i * 110, 46, '#7c3aed'), t(s, 180, 858 + i * 110, 700, 34, { fontWeight: 700, fill: '#2e1065' }),
      ]),
      t('You are not alone.', 80, 1220, 920, 34, { fontFamily: 'DM Sans', fontWeight: 700, fill: '#6d28d9', align: 'center' }),
    ])],
  },
  {
    id: 'corporate-newsletter', name: 'Corporate gym newsletter', category: 'Corporate Wellness', format: 'a4-portrait', tags: ['newsletter', 'gym', 'news', 'monthly'],
    pages: () => [
      page(W, [
        r(0, 0, 1240, 260, '#0f172a'),
        t('THE ACTIVE OFFICE', 80, 70, 900, 70, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, letterSpacing: 4 }),
        t('Company gym newsletter · Issue 12 · Spring', 80, 155, 900, 28, { fontWeight: 500, fill: '#94a3b8' }),
        im('photo-14.webp', 80, 320, 1080, 520, { radius: 20 }),
        t('New classes this season', 80, 890, 1080, 56, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('We’ve added early-morning HIIT, a Friday stretch and a beginners’ strength course. Book in the usual app; spaces are capped at 20 so the coaches can give everyone attention.', 80, 970, 520, 28, { fontWeight: 400, fill: '#334155', lineHeight: 1.55 }),
        t('Meet the coach', 640, 970, 520, 36, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('Each month we introduce one of the team. This issue: our strength lead, who has coached for ten years and loves a good deadlift PB.', 640, 1025, 520, 28, { fontWeight: 400, fill: '#334155', lineHeight: 1.55 }),
        r(80, 1460, 1080, 180, '#ecfdf5', { cornerRadius: 20 }),
        ic('Trophy', 120, 1505, 90, '#059669'),
        t('Step challenge winners: Finance team, 412,000 steps!', 240, 1525, 880, 34, { fontWeight: 800, fill: '#065f46' }),
      ]),
      page(W, [
        t('Your timetable', 80, 90, 1080, 60, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        ...['Mon 07:00 · HIIT & Core', 'Tue 12:30 · Lunch Break Burn', 'Wed 18:00 · Strength Basics', 'Thu 12:30 · Lunch Break Burn', 'Fri 08:00 · Stretch & Reset'].flatMap((s, i) => [
          r(80, 200 + i * 110, 1080, 90, i % 2 ? '#f8fafc' : '#eef2ff', { cornerRadius: 14 }),
          t(s, 110, 225 + i * 110, 1000, 34, { fontWeight: 600, fill: '#1e293b' }),
        ]),
        t('Healthy habit of the month', 80, 820, 1080, 44, { fontFamily: 'Montserrat', fontWeight: 800, fill: '#0f172a' }),
        t('Drink a glass of water before every coffee. Small, easy, and you’ll feel the difference by Friday.', 80, 885, 1080, 30, { fontWeight: 400, fill: '#334155', lineHeight: 1.5 }),
        im('illo-bottle', 820, 1050, 340, 340),
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
    id: 'ig-story', name: 'Instagram story: today’s workout', category: 'Social Media', format: 'ig-story', tags: ['instagram', 'story', 'workout', 'wod'],
    pages: () => [page('#0b0f19', [
      im('photo-3.webp', 0, 0, 1080, 1920, { opacity: 0.55 }),
      r(0, 0, 1080, 1920, grad(['rgba(11,15,25,0.2)', 'rgba(11,15,25,0.95)'], 180)),
      t('TODAY’S', 80, 640, 920, 90, { fontFamily: 'Anton', fontWeight: 400, fill: LIME }),
      t('WORKOUT', 80, 730, 920, 170, { fontFamily: 'Anton', fontWeight: 400, fill: W }),
      ...['10 burpees', '20 jump squats', '30 mountain climbers', '40-second plank', 'Repeat × 4'].flatMap((s, i) => [
        t(String(i + 1).padStart(2, '0'), 80, 960 + i * 120, 120, 56, { fontFamily: 'Anton', fontWeight: 400, fill: LIME }),
        t(s, 210, 970 + i * 120, 780, 50, { fontWeight: 800, fill: W }),
      ]),
      t('Tag us when you finish 💪', 80, 1640, 920, 40, { fontWeight: 600, fill: '#cbd5e1' }),
    ])],
  },
  {
    id: 'fb-post', name: 'Facebook post: open day', category: 'Social Media', format: 'fb-landscape', tags: ['facebook', 'open day', 'event'],
    pages: () => [page(BLUE, [
      im('photo-14.webp', 600, 0, 600, 630),
      r(560, 0, 140, 630, grad([BLUE, 'rgba(31,67,230,0)'], 90)),
      t('FREE OPEN DAY', 60, 80, 560, 30, { fontWeight: 800, letterSpacing: 6, fill: '#bfdbfe' }),
      t('Try any class\nfor free', 60, 130, 560, 76, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.05 }),
      t('Saturday 10am – 4pm · bring a friend', 60, 340, 540, 30, { fontWeight: 600, fill: '#dbeafe' }),
      sh('rect', 60, 450, 300, 80, ORANGE, { cornerRadius: 40 }), t('Save your spot', 60, 474, 300, 30, { fontWeight: 800, fill: W, align: 'center' }),
    ])],
  },
  {
    id: 'linkedin', name: 'LinkedIn promotional graphic', category: 'Social Media', format: 'linkedin', tags: ['linkedin', 'corporate', 'b2b', 'promotion'],
    pages: () => [page('#f8fafc', [
      r(0, 0, 14, 627, '#0a66c2'),
      t('CORPORATE WELLNESS PROGRAMMES', 70, 70, 700, 24, { fontWeight: 800, letterSpacing: 4, fill: '#0a66c2' }),
      t('Healthier teams are\nhappier teams.', 70, 115, 640, 58, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#0f172a', lineHeight: 1.1 }),
      t('On-site classes, wellness weeks and step challenges for companies of every size.', 70, 290, 560, 26, { fontWeight: 400, fill: '#475569', lineHeight: 1.45 }),
      ...[['Users', '40+ companies'], ['Activity', '12,000 classes'], ['Smile', '96% would recommend']].flatMap(([icon, s], i) => [
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
        t('2026 PLAN', 120, 160, 700, 36, { fontWeight: 800, letterSpacing: 10, fill: '#818cf8' }),
        t('Growing our\ncommunity', 115, 230, 820, 130, { fontFamily: 'Montserrat', fontWeight: 900, fill: W, lineHeight: 1.02 }),
        t('Strategy, classes and partnerships for the year ahead', 120, 560, 720, 38, { fontWeight: 400, fill: '#cbd5e1', lineHeight: 1.4 }),
        r(120, 860, 80, 6, '#818cf8'),
        t('Prepared by the studio team · January', 120, 900, 720, 28, { fontWeight: 600, fill: '#94a3b8' }),
      ]),
      page(W, [
        t('Agenda', 120, 120, 1000, 90, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#0f172a' }),
        ...['Where we are today', 'Members and classes', 'New programmes', 'Partnerships', 'Next steps'].flatMap((s, i) => [
          t(String(i + 1).padStart(2, '0'), 120, 290 + i * 130, 140, 64, { fontFamily: 'Anton', fontWeight: 400, fill: '#6366f1' }),
          t(s, 270, 300 + i * 130, 1200, 50, { fontWeight: 700, fill: '#0f172a' }),
        ]),
      ]),
      page('#eef2ff', [
        t('Members are up 38%', 120, 120, 1200, 80, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#1e1b4b' }),
        t('Monthly active members, last six months', 120, 220, 1000, 32, { fontWeight: 500, fill: '#4338ca' }),
        ...[120, 160, 190, 230, 270, 330].flatMap((v, i) => [
          sh('rect', 160 + i * 250, 920 - v * 1.8, 160, v * 1.8, i === 5 ? '#6366f1' : '#c7d2fe', { cornerRadius: 16 }),
          t(['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan'][i], 160 + i * 250, 950, 160, 30, { fontWeight: 700, fill: '#312e81', align: 'center' }),
        ]),
      ]),
    ],
  },
  {
    id: 'service-promo', name: 'Service promotion', category: 'Business and Presentations', format: 'ig-portrait', tags: ['service', 'promotion', 'offer', 'business'],
    pages: () => [page(W, [
      r(0, 0, 1080, 760, '#111827'),
      im('photo-15.webp', 0, 0, 1080, 760, { opacity: 0.7 }),
      t('GROUP CLASSES FOR YOUR TEAM', 70, 820, 940, 30, { fontWeight: 800, letterSpacing: 5, fill: '#6366f1' }),
      t('Team-building that actually gets people moving.', 70, 870, 940, 64, { fontFamily: 'Montserrat', fontWeight: 900, fill: '#111827', lineHeight: 1.1 }),
      t('Private studio hire · dance, fitness or both · from 8 to 40 people', 70, 1050, 940, 30, { fontWeight: 500, fill: '#4b5563' }),
      sh('rect', 70, 1160, 420, 96, '#6366f1', { cornerRadius: 48 }), t('Get a quote', 70, 1188, 420, 38, { fontWeight: 800, fill: W, align: 'center' }),
      t('hello@yourstudio.com', 520, 1192, 500, 32, { fontWeight: 600, fill: '#6366f1' }),
    ])],
  },
  {
    id: 'newsletter-banner', name: 'Newsletter banner', category: 'Business and Presentations', format: 'banner', tags: ['banner', 'newsletter', 'email', 'header'],
    pages: () => [page(grad(['#1f43e6', '#7c3aed'], 90), [
      sh('ellipse', 1250, -200, 600, 600, 'rgba(255,255,255,0.1)'),
      t('THE MONTHLY MOVE', 90, 110, 1000, 110, { fontFamily: 'Bebas Neue', fontWeight: 400, fill: W, letterSpacing: 6 }),
      t('News, new classes and member stories · March edition', 95, 250, 1000, 36, { fontWeight: 500, fill: '#e0e7ff' }),
      im('illo-dumbbell', 1180, 40, 420, 420),
    ])],
  },
  {
    id: 'event-announcement', name: 'Event announcement', category: 'Business and Presentations', format: 'fb-landscape', tags: ['event', 'party', 'announcement', 'social'],
    pages: () => [page('#0b0f19', [
      im('class-14.webp', 0, 0, 1200, 630, { opacity: 0.45 }),
      r(0, 0, 1200, 630, grad(['rgba(11,15,25,0.95)', 'rgba(11,15,25,0.2)'], 90)),
      t('YOU’RE INVITED', 70, 80, 700, 28, { fontWeight: 800, letterSpacing: 8, fill: ORANGE }),
      t('Summer\nShowcase', 65, 120, 700, 110, { fontFamily: 'Anton', fontWeight: 400, fill: W, lineHeight: 1 }),
      t('Performances, music and drinks on the terrace', 70, 390, 640, 30, { fontWeight: 500, fill: '#e5e7eb' }),
      ic('Calendar', 70, 480, 40, ORANGE), t('Sat 21 June · 7pm', 125, 484, 400, 30, { fontWeight: 800, fill: W }),
      sh('star', 980, 60, 150, 150, ORANGE, { rotation: 10 }), t('FREE', 980, 120, 150, 34, { fontWeight: 900, fill: INK, align: 'center', rotation: 10 }),
    ])],
  },
];

// A plain image element helper re-exported for the Drop event generator.
export function photoFrame(src: string, w: number, h: number, x: number, y: number, iw: number, ih: number, radius = 0) {
  return makeImage({ src, x, y, width: w, height: h, crop: coverCrop(iw, ih, w, h), cornerRadius: radius });
}
export { lib };

export const TEMPLATE_CATEGORIES = ['Fitness and Gym', 'Corporate Wellness', 'Social Media', 'Business and Presentations'] as const;
