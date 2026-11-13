import { supabase } from './supabase';

export interface ThSettings { enabled: boolean; auto_reply: boolean; auto_tag_thanks: boolean; daily_story: boolean; story_hour: number; notes: string | null }
export interface ThThread { id: string; ig_user_id: string; username: string | null; display_name: string | null; status: 'open' | 'needs_human' | 'closed'; last_inbound_at: string | null; last_message_at: string; language: string | null; memory: string | null }
export interface ThMessage { id: string; thread_id: string; direction: 'in' | 'out'; kind: string; text: string; status: 'received' | 'draft' | 'sent' | 'rejected' | 'failed'; needs_human: boolean; reason: string | null; translation: string | null; error: string | null; created_at: string }
export interface ThMention { id: string; kind: 'post' | 'story'; username: string | null; permalink: string | null; caption: string | null; media_url: string | null; reply_text: string | null; reply_status: 'draft' | 'sent' | 'rejected' | 'failed' | 'skipped'; error: string | null; reshared: boolean; received_at: string }
export interface ThStory { id: string; story_date: string; title: string; lines: { time: string; title: string; instructor: string | null; style_slug: string | null }[]; art_slug: string | null; status: string; error: string | null }
export interface ThDraft { reply: string; needs_human: boolean; reason: string; topic: string; language: string; offered_language: boolean; translation_en: string; memory: string }
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
  publishStory: async (storyId: string, png: Blob) => {
    const path = `stories/${storyId}-${Date.now()}.png`;
    const up = await supabase.storage.from('assistant-media').upload(path, png, { contentType: 'image/png' });
    if (up.error) throw new Error(up.error.message);
    return call({ action: 'story_publish', story_id: storyId, image_path: path });
  },
  skipStory: (storyId: string) => call({ action: 'story_skip', story_id: storyId }),
};

/** Draw the daily Story (1080×1920) in the browser: class artwork, "TODAY AT DROP" and the class list. */
export async function renderStory(s: ThStory): Promise<Blob> {
  const HEAD = '"Archivo Variable", Archivo, "Inter Variable", sans-serif', BODY = '"Inter Variable", Inter, sans-serif';
  await Promise.all([`900 150px ${HEAD}`, `800 52px ${BODY}`, `500 32px ${BODY}`, `900 36px ${BODY}`].map((f) => document.fonts.load(f).catch(() => null)));
  await document.fonts.ready;
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1920;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b0b0d'; g.fillRect(0, 0, 1080, 1920);
  // Background: one of the studio's portrait photos (a different one each day), fading into black behind the text.
  const photos = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12];
  const pick = photos[Number(s.story_date.replace(/-/g, '')) % photos.length];
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = `/studio/photo-${pick}.webp`;
  await img.decode().catch(() => null);
  if (img.naturalWidth) {
    const sc = Math.max(1080 / img.naturalWidth, 1060 / img.naturalHeight);
    g.drawImage(img, (1080 - img.naturalWidth * sc) / 2, 0, img.naturalWidth * sc, img.naturalHeight * sc);
  }
  const grad = g.createLinearGradient(0, 560, 0, 1040); grad.addColorStop(0, 'rgba(11,11,13,0)'); grad.addColorStop(1, '#0b0b0d');
  g.fillStyle = grad; g.fillRect(0, 560, 1080, 480);
  g.fillStyle = '#0b0b0d'; g.fillRect(0, 1040, 1080, 880);
  g.fillStyle = '#ff7a00'; g.font = `900 34px ${BODY}`; g.fillText(new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${s.story_date}T12:00:00`)).toUpperCase(), 80, 1080);
  // Headline shrinks to fit the width.
  let size = 150; g.font = `900 ${size}px ${HEAD}`;
  while (g.measureText(s.title).width > 920 && size > 60) { size -= 6; g.font = `900 ${size}px ${HEAD}`; }
  g.fillStyle = '#ffffff'; g.fillText(s.title, 78, 1230);
  let y = 1340;
  for (const l of s.lines.slice(0, 5)) {
    g.fillStyle = '#ff7a00'; g.font = `800 52px ${BODY}`; g.fillText(l.time, 80, y);
    g.fillStyle = '#ffffff'; g.font = `800 52px ${BODY}`; g.fillText(l.title, 270, y);
    if (l.instructor) { g.fillStyle = '#a1a1aa'; g.font = `500 32px ${BODY}`; g.fillText(`with ${l.instructor}`, 270, y + 44); }
    y += 120;
  }
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(80, 1770, 560, 90, 45); g.fill();
  g.fillStyle = '#0b0b0d'; g.font = `900 36px ${BODY}`; g.fillText('BOOK IN THE APP ↗', 120, 1828);
  g.fillStyle = '#d4d4d8'; g.font = `700 32px ${BODY}`; g.fillText('dropstudios.ie', 690, 1828);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not create the image'))), 'image/png'));
}
