import { sessionImage } from '../config/classImages';
import { supabase } from './supabase';

export interface ThSettings { enabled: boolean; auto_reply: boolean; auto_tag_thanks: boolean; daily_story: boolean; story_hour: number; daily_report: boolean; report_hour: number; auto_comment_reply: boolean; story_auto_publish: boolean; weekly_schedule: boolean; weekly_hour: number; weekly_days: number[]; notes: string | null }
export interface ThComment { id: string; username: string | null; text: string; post_caption: string | null; permalink: string | null; reply_text: string | null; reply_status: 'draft' | 'sent' | 'rejected' | 'failed' | 'skipped'; needs_human: boolean; out_of_ordinary: boolean; reason: string | null; translation: string | null; error: string | null; received_at: string }
export interface ThPromo { id: string; title: string; items: { path: string; kind: 'image' | 'video'; label?: string }[]; every_days: number; post_hour: number; starts_on: string | null; ends_on: string | null; enabled: boolean; last_posted_on: string | null; posts_done: number; last_error: string | null }
export interface ThGuidance { id: string; comment_id: string | null; question: string; asked_text: string | null; answer: string | null; status: 'open' | 'answered' | 'dismissed'; thread_id: string | null; created_at: string; answered_at: string | null; assistant_threads: { username: string | null } | null }
export interface ThReportStats { messages_in: number; people: number; new_people: number; replies_sent: number; auto_sent: number; handed_to_you: number; waiting: number; tags: number; story: string; topics: Record<string, number>; new_questions: { question: string; answered: boolean }[]; open_questions: number; comments?: number; comments_replied?: number; comments_waiting?: number; reactions_week?: number; last_story?: ({ date: string } & Record<string, number | string>) | null }
export interface ThReport { id: string; report_date: string; stats: ThReportStats; summary: string | null; themes: { theme: string; count: number }[]; suggestions: string[]; created_at: string }
export interface ThThread { id: string; ig_user_id: string; username: string | null; display_name: string | null; status: 'open' | 'needs_human' | 'closed'; last_inbound_at: string | null; last_message_at: string; language: string | null; memory: string | null }
export interface ThMessage { id: string; thread_id: string; direction: 'in' | 'out'; kind: string; text: string; status: 'received' | 'draft' | 'sent' | 'rejected' | 'failed'; needs_human: boolean; reason: string | null; translation: string | null; error: string | null; reaction?: string | null; created_at: string }
export interface ThMention { id: string; kind: 'post' | 'story'; username: string | null; permalink: string | null; caption: string | null; media_url: string | null; reply_text: string | null; reply_status: 'draft' | 'sent' | 'rejected' | 'failed' | 'skipped'; error: string | null; reshared: boolean; received_at: string }
export interface ThStory { id: string; story_date: string; insights: Record<string, number> | null; photo_url?: string | null; photos?: Record<string, string>; ig_media_ids?: string[] | null; title: string; lines: { time: string; title: string; instructor: string | null; style_slug: string | null; instructor_id?: string | null; starts_at?: string }[]; art_slug: string | null; status: string; error: string | null }
export interface ThDraft { reply: string; needs_human: boolean; reason: string; topic: string; language: string; offered_language: boolean; translation_en: string; memory: string; out_of_ordinary: boolean; question_en: string }
export interface Turn { from: 'member' | 'thamires'; text: string }

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('thamires', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const payload = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(payload?.error === 'claude_not_configured' ? 'Thamires’ AI key isn’t set up yet.' : payload?.error ?? 'Thamires is not reachable right now.');
  }
  return data as T;
}
const rows = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => { const r = await q; if (r.error) throw new Error(r.error.message); return (r.data ?? []) as T; };

export const thamires = {
  status: () => call<{ instagram: boolean; claude: boolean; webhook: boolean }>({ action: 'status' }),
  settings: async () => (await rows<ThSettings[]>(supabase.from('assistant_settings').select('*').limit(1)))[0],
  saveSettings: async (patch: Partial<ThSettings>) => { const r = await supabase.from('assistant_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true); if (r.error) throw new Error(r.error.message); },
  drafts: () => rows<(ThMessage & { assistant_threads: ThThread })[]>(supabase.from('assistant_messages').select('*, assistant_threads(*)').eq('status', 'draft').order('created_at')),
  threads: () => rows<ThThread[]>(supabase.from('assistant_threads').select('*').order('last_message_at', { ascending: false }).limit(50)),
  messages: (threadId: string) => rows<ThMessage[]>(supabase.from('assistant_messages').select('*').eq('thread_id', threadId).neq('status', 'rejected').order('created_at')),
  mentions: () => rows<ThMention[]>(supabase.from('assistant_mentions').select('*').order('received_at', { ascending: false }).limit(30)),
  story: (date: string) => rows<ThStory[]>(supabase.from('assistant_stories').select('*').eq('story_date', date)).then((r) => r[0] ?? null),
  test: (history: Turn[], person?: { username?: string; display_name?: string; language?: string | null; language_offered?: boolean; memory?: string | null }) => call<ThDraft>({ action: 'test', history, person }),
  send: (messageId: string, text: string) => call({ action: 'send', message_id: messageId, text }),
  reject: async (messageId: string) => { const r = await supabase.rpc('assistant_reject', { p_message_id: messageId }); if (r.error) throw new Error(r.error.message); },
  reply: (threadId: string, text: string) => call({ action: 'reply', thread_id: threadId, text }),
  forget: (threadId: string) => call({ action: 'forget', thread_id: threadId }),
  threadStatus: (threadId: string, status: string) => call({ action: 'thread_status', thread_id: threadId, status }),
  mentionSend: (id: string, text: string) => call({ action: 'mention_send', mention_id: id, text }),
  mentionSkip: (id: string) => call({ action: 'mention_skip', mention_id: id }),
  reshared: async (id: string, done: boolean) => { const r = await supabase.rpc('assistant_mark_reshared', { p_mention_id: id, p_done: done }); if (r.error) throw new Error(r.error.message); },
  prepareStory: () => call({ action: 'story_prepare' }),
  /** Upload one image per class and publish them as Stories, in order. */
  publishStories: async (storyId: string, images: Blob[]) => {
    const stamp = Date.now(), paths: string[] = [];
    for (const [i, img] of images.entries()) {
      const path = `stories/${storyId}-${stamp}-${i + 1}.jpg`;
      const up = await supabase.storage.from('assistant-media').upload(path, img, { contentType: 'image/jpeg' });
      if (up.error) throw new Error(up.error.message);
      paths.push(path);
    }
    return call<{ ok: true; published: number }>({ action: 'story_publish', story_id: storyId, image_paths: paths });
  },
  skipStory: (storyId: string) => call({ action: 'story_skip', story_id: storyId }),
  setStoryPhoto: async (storyId: string, url: string | null, index: number) => { const r = await supabase.rpc('assistant_set_story_photo', { p_story_id: storyId, p_photo_url: url, p_index: index }); if (r.error) throw new Error(r.error.message); },
  guidance: () => rows<ThGuidance[]>(supabase.from('assistant_guidance').select('*, assistant_threads(username)').neq('status', 'dismissed').order('created_at', { ascending: false }).limit(100)),
  guide: (id: string, answer: string) => call<{ ok: true; redrafted: boolean }>({ action: 'guide', guidance_id: id, answer }),
  dismissGuidance: (id: string) => call({ action: 'guidance_dismiss', guidance_id: id }),
  reports: () => rows<ThReport[]>(supabase.from('assistant_reports').select('*').order('report_date', { ascending: false }).limit(14)),
  reportNow: () => call({ action: 'report_now' }),
  storyPreview: (storyId: string, index: number) => call<{ png: string }>({ action: 'story_preview', story_id: storyId, index }),
  publishServer: (storyId: string) => call<{ posted: number; error?: string }>({ action: 'story_publish_server', story_id: storyId }),
  weekPreview: () => call<{ png: string; week_start: string }>({ action: 'week_preview' }),
  weekPostNow: () => call<{ ok?: boolean; error?: string; classes?: number }>({ action: 'week_post_now' }),
  weekly: () => rows<{ id: string; post_date: string; week_start: string; status: string; classes: number | null; error: string | null }[]>(supabase.from('assistant_weekly').select('*').order('post_date', { ascending: false }).limit(6)),
  promos: () => rows<ThPromo[]>(supabase.from('assistant_promos').select('*').order('created_at')),
  setPromo: async (id: string, patch: Partial<Pick<ThPromo, 'enabled' | 'every_days' | 'post_hour' | 'starts_on' | 'ends_on'>>) => { const r = await supabase.from('assistant_promos').update(patch).eq('id', id); if (r.error) throw new Error(r.error.message); },
  postPromoNow: (id: string) => call<Record<string, { posted?: number; error?: string }>>({ action: 'promo_post_now', promo_id: id }),
  mediaUrl: (path: string) => supabase.storage.from('assistant-media').getPublicUrl(path).data.publicUrl,
  comments: () => rows<ThComment[]>(supabase.from('assistant_comments').select('*').order('received_at', { ascending: false }).limit(50)),
  commentSend: (id: string, text: string) => call({ action: 'comment_send', comment_id: id, text }),
  commentSkip: (id: string) => call({ action: 'comment_skip', comment_id: id }),
  recentStories: () => rows<ThStory[]>(supabase.from('assistant_stories').select('*').eq('status', 'published').order('story_date', { ascending: false }).limit(7)),
};

// ---------- Daily Story image ----------

/** Photos to choose from for the Story: Drop's class artwork, then studio photos. */
export const STORY_PHOTOS: { url: string; label: string }[] = [
  { url: '/classes/heels.webp', label: 'Heels' },
  { url: '/classes/fitdance.webp', label: 'FitDance' },
  { url: '/classes/fitdance-joao-pink.webp', label: 'FitDance (João, pink)' },
  { url: '/classes/fitdance-joao-green.webp', label: 'FitDance (João, green)' },
  { url: '/classes/fitdance-joao-red.webp', label: 'FitDance (João, red)' },
  { url: '/classes/commercial.webp', label: 'Commercial' },
  { url: '/classes/hip-hop.webp', label: 'Hip Hop' },
  { url: '/classes/jazz-funk.webp', label: 'Jazz Funk' },
  { url: '/classes/reggaeton.webp', label: 'Reggaeton' },
  { url: '/classes/choreography.webp', label: 'Choreography' },
  ...Array.from({ length: 16 }, (_, i) => ({ url: `/studio/photo-${i + 1}.webp`, label: `Studio photo ${i + 1}` })),
];

/** The photo for one class's Story: the one chosen by an admin, else that instructor's or style's artwork, else a studio photo. */
export function storyPhoto(s: ThStory, index = 0): string {
  const chosen = s.photos?.[String(index)] ?? (index === 0 ? s.photo_url : null);
  if (chosen) return chosen;
  const l = s.lines[index];
  return (l && sessionImage(l.style_slug, l.instructor_id ?? null, l.starts_at)?.card) ?? '/studio/photo-6.webp';
}

/** How many Stories a day has: one per class. */
export const storyCount = (s: ThStory) => s.lines.length;

const loadImg = async (src: string) => {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src;
  await img.decode().catch(() => null);
  return img.naturalWidth ? img : null;
};

/** Draw one class's Story (1080×1920) in the browser: a full-screen photo or the class artwork, the time and class in big type, and a "Book now" sticker. */
export async function renderStory(day: ThStory, index = 0): Promise<Blob> {
  const s: ThStory = { ...day, lines: day.lines.slice(index, index + 1) };
  const HEAD = '"Archivo Variable", Archivo, "Inter Variable", sans-serif', BODY = '"Inter Variable", Inter, sans-serif';
  await Promise.all([`900 150px ${HEAD}`, `800 52px ${BODY}`, `500 32px ${BODY}`, `900 36px ${BODY}`, `700 40px ${BODY}`].map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  const W = 1080, H = 1920, ORANGE = '#ff7a00', INK = '#0b0b0d';
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = INK; g.fillRect(0, 0, W, H);
  const src = storyPhoto(day, index);
  const img = await loadImg(src);
  const lines = s.lines.slice(0, 5), n = Math.max(1, lines.length);
  const artwork = src.startsWith('/classes/'); // Drop's 4:5 class artwork (logo and style name built in)
  const cover = (im: HTMLImageElement, x: number, y: number, w: number, h: number) => {
    const sc = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    g.drawImage(im, x + (w - im.naturalWidth * sc) / 2, y + (h - im.naturalHeight * sc) / 2, im.naturalWidth * sc, im.naturalHeight * sc);
  };
  // Fewer classes, bigger type.
  const fs = n <= 2 ? 80 : n === 3 ? 72 : 64, step = n <= 2 ? 150 : n === 3 ? 135 : 120, nameX = n <= 2 ? 360 : 330;
  let top: number; // where the text block starts
  if (img && artwork) {
    // Full-screen blurred artwork behind, the sharp artwork on top: no empty space, the class colour everywhere.
    // Blur by shrinking the artwork to a few pixels and stretching it back (works in every browser, Safari included).
    const tiny = document.createElement('canvas'); tiny.width = 18; tiny.height = 32;
    const tg = tiny.getContext('2d')!; tg.imageSmoothingQuality = 'high';
    const ts = Math.max(18 / img.naturalWidth, 32 / img.naturalHeight);
    tg.drawImage(img, (18 - img.naturalWidth * ts) / 2, (32 - img.naturalHeight * ts) / 2, img.naturalWidth * ts, img.naturalHeight * ts);
    g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(tiny, -60, -60, W + 120, H + 120); g.restore();
    g.fillStyle = 'rgba(11,11,13,0.35)'; g.fillRect(0, 0, W, H);
    const aw = n === 1 ? W : n === 2 ? 960 : n === 3 ? 840 : 720, ah = aw * 1.25, ax = (W - aw) / 2, ay = n === 1 ? 0 : 56;
    g.save();
    if (n > 1) { g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 40; g.beginPath(); g.roundRect(ax, ay, aw, ah, 36); g.clip(); }
    g.drawImage(img, ax, ay, aw, ah); g.restore();
    top = n === 1 ? 1330 : n === 2 ? 1300 : n === 3 ? 1180 : 1030;
  } else {
    if (img) cover(img, 0, 0, W, H);
    top = n === 1 ? 1330 : 1540 - (n - 1) * step; // the last class ends just above the Book now sticker
    const logo = await loadImg('/brand/drop-logo-white.svg');
    if (logo) { const lw = 300; g.drawImage(logo, 64, 72, lw, lw * (logo.naturalHeight / logo.naturalWidth)); }
  }
  // Dark fade behind the text so it is always readable.
  const fadeFrom = Math.max(0, top - 380);
  const grad = g.createLinearGradient(0, fadeFrom, 0, top + 40);
  grad.addColorStop(0, 'rgba(11,11,13,0)'); grad.addColorStop(1, 'rgba(11,11,13,0.9)');
  g.fillStyle = grad; g.fillRect(0, fadeFrom, W, top + 40 - fadeFrom);
  g.fillStyle = 'rgba(11,11,13,0.9)'; g.fillRect(0, top + 40, W, H - top - 40);

  const fit = (text: string, weight: number, size: number, max: number, family = HEAD) => {
    g.font = `${weight} ${size}px ${family}`;
    while (g.measureText(text).width > max && size > 28) { size -= 4; g.font = `${weight} ${size}px ${family}`; }
    return size;
  };
  const date = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${s.story_date}T12:00:00`)).toUpperCase();
  g.textBaseline = 'alphabetic';
  if (!lines.length) {
    g.fillStyle = '#ffffff'; fit(s.title, 900, 120, 920); g.fillText(s.title, 80, top + 150);
  } else if (n === 1) {
    const l = lines[0];
    g.fillStyle = ORANGE; g.font = `800 40px ${BODY}`; g.fillText(`TODAY · ${date}`, 80, top);
    g.fillStyle = ORANGE; g.font = `900 150px ${HEAD}`; g.fillText(l.time, 74, top + 160);
    g.fillStyle = '#ffffff'; fit(l.title.toUpperCase(), 900, 96, 920); g.fillText(l.title.toUpperCase(), 78, top + 262);
    if (l.instructor) { g.fillStyle = '#d4d4d8'; g.font = `600 44px ${BODY}`; g.fillText(`with ${l.instructor}`, 80, top + 322); }
  } else {
    g.fillStyle = ORANGE; g.font = `800 40px ${BODY}`; g.fillText(`TODAY AT DROP · ${date}`, 80, top);
    lines.forEach((l, i) => {
      const y = top + 100 + i * step;
      g.fillStyle = ORANGE; g.font = `900 ${fs}px ${HEAD}`; g.fillText(l.time, 80, y);
      g.fillStyle = '#ffffff'; fit(l.title.toUpperCase(), 900, fs, 1000 - nameX); g.fillText(l.title.toUpperCase(), nameX, y);
      if (l.instructor) { g.fillStyle = '#a1a1aa'; g.font = `600 ${n <= 2 ? 38 : 32}px ${BODY}`; g.fillText(`with ${l.instructor}`, nameX + 2, y + (n <= 2 ? 48 : 40)); }
    });
  }
  // "Book now" sticker, styled like an Instagram link sticker.
  const sy = 1726, sh = 120;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 24; g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(80, sy, 920, sh, 28); g.fill(); g.restore();
  g.fillStyle = ORANGE; g.beginPath(); g.arc(150, sy + sh / 2, 40, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.lineCap = 'round';
  g.beginPath(); g.moveTo(134, sy + sh / 2 + 16); g.lineTo(166, sy + sh / 2 - 16); g.moveTo(140, sy + sh / 2 - 16); g.lineTo(166, sy + sh / 2 - 16); g.lineTo(166, sy + sh / 2 + 10); g.stroke();
  g.fillStyle = INK; g.font = `900 46px ${HEAD}`; g.fillText('BOOK NOW', 214, sy + 58);
  g.fillStyle = ORANGE; g.font = `700 34px ${BODY}`; g.fillText('dropstudios.ie/app', 214, sy + 98);
  // Instagram only publishes JPEG images.
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image'))), 'image/jpeg', 0.92));
}

/** Upload a photo for the Story (resized and saved as JPEG, so iPhone photos work too). Returns its public URL. */
export async function uploadStoryPhoto(file: File): Promise<string> {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('That photo format isn’t supported. Try a JPEG or PNG.'); });
  const sc = Math.min(1, 2160 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not read the photo'))), 'image/jpeg', 0.9));
  const path = `stories/photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const up = await supabase.storage.from('assistant-media').upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  return supabase.storage.from('assistant-media').getPublicUrl(path).data.publicUrl;
}
