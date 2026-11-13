// Thamires: Drop's AI assistant on Instagram.
// - Instagram webhooks (DMs, story mentions, post mentions): store, draft a reply, send it if auto mode allows.
// - Admin actions from the Drop app (approve/edit/send drafts, test her, publish the daily Story).
// - A scheduled call prepares the daily Story draft.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { canAutoSend, draftReply, type Draft, type Turn } from './brain.ts';
import { ig, igConfig, parseWebhook, verifySignature, type IgEvent } from './instagram.ts';

type Db = SupabaseClient;
const anthropic = () => (Deno.env.get('ANTHROPIC_API_KEY') ? new Anthropic() : null);
const background = (p: Promise<unknown>) => {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt) rt.waitUntil(p); else return p;
};

async function settings(db: Db) {
  const { data } = await db.from('assistant_settings').select('*').single();
  return data as { enabled: boolean; auto_reply: boolean; auto_tag_thanks: boolean; daily_story: boolean; story_hour: number } | null;
}

interface Person { username?: string | null; display_name?: string | null; language?: string | null; language_offered?: boolean }
async function draft(history: Turn[], disclose: boolean, task: 'dm' | 'thanks', db: Db, who: Person = {}): Promise<Draft | null> {
  const client = anthropic();
  if (!client) return null;
  const { data: knowledge } = await db.rpc('assistant_knowledge');
  return draftReply({ client }, { history, knowledge, disclose, task, person: { username: who.username, name: who.display_name }, language: who.language, languageOffered: who.language_offered });
}

/** Remember the language the conversation settled on, and that she offered to switch. */
async function rememberLanguage(db: Db, threadId: string, d: Draft, history: Turn[]) {
  const patch: Record<string, unknown> = {};
  if (d.offered_language) patch.language_offered = true;
  // Only lock in a language once the person has written in it (not just because she offered it).
  if (d.language && history.some((t) => t.from === 'member') && !d.offered_language) patch.language = d.language;
  if (Object.keys(patch).length) await db.from('assistant_threads').update(patch).eq('id', threadId);
}

async function thread(db: Db, igUserId: string) {
  const { data: existing } = await db.from('assistant_threads').select('*').eq('ig_user_id', igUserId).maybeSingle();
  if (existing) return existing as { id: string; disclosed: boolean; username: string | null };
  const cfg = igConfig();
  const prof = cfg ? await ig.profile(cfg, igUserId) : {};
  const { data } = await db.from('assistant_threads').upsert({ ig_user_id: igUserId, username: prof.username ?? null, display_name: prof.name ?? null }, { onConflict: 'ig_user_id' }).select().single();
  return data as { id: string; disclosed: boolean; username: string | null; display_name: string | null; language: string | null; language_offered: boolean };
}

async function history(db: Db, threadId: string): Promise<Turn[]> {
  const { data } = await db.from('assistant_messages').select('direction, text, status, kind').eq('thread_id', threadId)
    .in('status', ['received', 'sent']).order('created_at', { ascending: false }).limit(20);
  return ((data ?? []) as { direction: string; text: string }[]).reverse().map((m) => ({ from: m.direction === 'in' ? 'member' : 'thamires', text: m.text }));
}

async function sendDraft(db: Db, messageId: string, text: string, actor: string | null) {
  const cfg = igConfig();
  const { data: m } = await db.from('assistant_messages').select('id, thread_id, status, assistant_threads(ig_user_id, last_inbound_at)').eq('id', messageId).single();
  if (!m) throw new Error('not_found');
  const t = (m as unknown as { assistant_threads: { ig_user_id: string; last_inbound_at: string | null } }).assistant_threads;
  if (!cfg) throw new Error('Instagram is not connected yet.');
  if (t.last_inbound_at && Date.now() - new Date(t.last_inbound_at).getTime() > 24 * 3600e3) throw new Error('Instagram only allows replies within 24 hours of their last message.');
  try {
    const r = await ig.sendDm(cfg, t.ig_user_id, text);
    await db.from('assistant_messages').update({ text, status: 'sent', sent_at: new Date().toISOString(), decided_by: actor, ig_message_id: r.message_id ?? null, error: null }).eq('id', messageId);
    await db.from('assistant_threads').update({ disclosed: true, last_message_at: new Date().toISOString() }).eq('id', m.thread_id);
  } catch (e) {
    await db.from('assistant_messages').update({ status: 'failed', error: (e as Error).message, decided_by: actor }).eq('id', messageId);
    throw e;
  }
}

async function handleEvent(db: Db, ev: IgEvent) {
  const s = await settings(db);
  const cfg = igConfig();
  if (ev.type === 'post_mention') {
    const media = cfg ? await ig.mentionedMedia(cfg, ev.mediaId) : {};
    const { data: row, error } = await db.from('assistant_mentions').insert({ ig_media_id: ev.mediaId, kind: 'post', username: media.username ?? null, permalink: media.permalink ?? null, caption: media.caption ?? null, media_url: media.media_url ?? null }).select().single();
    if (error || !row || !s?.enabled) return; // duplicate delivery or Thamires off
    const d = await draft([{ from: 'member', text: `@${media.username ?? 'someone'} tagged Drop in a post: ${media.caption ?? '(no caption)'}` }], false, 'thanks', db);
    if (!d) return;
    await db.from('assistant_mentions').update({ reply_text: d.reply }).eq('id', row.id);
    if (s.auto_tag_thanks && !d.needs_human && cfg) {
      try { await ig.commentOnMention(cfg, ev.mediaId, d.reply); await db.from('assistant_mentions').update({ reply_status: 'sent' }).eq('id', row.id); return; }
      catch (e) { await db.from('assistant_mentions').update({ reply_status: 'failed', error: (e as Error).message }).eq('id', row.id); }
    }
    await db.rpc('_assistant_notify', { p_kind: 'assistant_tag', p_payload: { username: media.username ?? 'someone', kind: 'post' }, p_key: `tag:${row.id}` });
    return;
  }

  const t = await thread(db, ev.from);
  const text = ev.type === 'story_mention' ? '[Mentioned Drop in their Story]' : ev.text;
  const { error: dup } = await db.from('assistant_messages').insert({ thread_id: t.id, direction: 'in', kind: ev.type === 'message' ? 'dm' : ev.type, text, ig_message_id: ev.mid, status: 'received' });
  if (dup) return; // Instagram re-delivered the same message
  await db.from('assistant_threads').update({ last_inbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq('id', t.id);
  if (!s?.enabled) return;

  if (ev.type === 'story_mention') {
    const { data: row } = await db.from('assistant_mentions').insert({ ig_media_id: ev.mid, kind: 'story', ig_user_id: ev.from, username: t.username, media_url: ev.url }).select().single();
    const d = await draft([{ from: 'member', text: `@${t.username ?? 'someone'} mentioned Drop in their Instagram Story.` }], !t.disclosed, 'thanks', db, t);
    if (!d || !row) return;
    await db.from('assistant_mentions').update({ reply_text: d.reply }).eq('id', row.id);
    if (s.auto_tag_thanks && !d.needs_human && cfg) {
      try { await ig.sendDm(cfg, ev.from, d.reply); await db.from('assistant_mentions').update({ reply_status: 'sent' }).eq('id', row.id); await db.from('assistant_threads').update({ disclosed: true }).eq('id', t.id); return; }
      catch (e) { await db.from('assistant_mentions').update({ reply_status: 'failed', error: (e as Error).message }).eq('id', row.id); }
    }
    await db.rpc('_assistant_notify', { p_kind: 'assistant_tag', p_payload: { username: t.username ?? 'someone', kind: 'story' }, p_key: `tag:${row.id}` });
    return;
  }

  const hist = await history(db, t.id);
  const d = await draft(hist, !t.disclosed, 'dm', db, t);
  if (!d) return;
  await rememberLanguage(db, t.id, d, hist);
  const { data: out } = await db.from('assistant_messages').insert({ thread_id: t.id, direction: 'out', kind: 'dm', text: d.reply, status: 'draft', needs_human: d.needs_human, reason: d.reason, translation: d.translation_en || null }).select().single();
  if (d.needs_human) await db.from('assistant_threads').update({ status: 'needs_human' }).eq('id', t.id);
  if (s.auto_reply && canAutoSend(d) && out) {
    try { await sendDraft(db, out.id, d.reply, null); return; } catch (e) { console.error('auto-send failed', (e as Error).message); }
  }
  await db.rpc('_assistant_notify', { p_kind: 'assistant_draft', p_payload: { username: t.username ?? 'someone', preview: text.slice(0, 120), needs_human: d.needs_human }, p_key: `draft:${out?.id}` });
}

/** Prepare today's Story from the timetable (rendered and published from the admin page). */
async function dailyStory(db: Db, force = false) {
  const s = await settings(db);
  if (!force && (!s?.enabled || !s.daily_story)) return { skipped: 'off' };
  const now = new Date();
  const dublin = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (t: string) => dublin.find((p) => p.type === t)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  if (!force && Number(part('hour')) < (s?.story_hour ?? 10)) return { skipped: 'too_early' };
  const { data: existing } = await db.from('assistant_stories').select('id').eq('story_date', today).maybeSingle();
  if (existing) return { skipped: 'exists' };
  const start = new Date(`${today}T00:00:00Z`); const end = new Date(start.getTime() + 36 * 3600e3);
  const { data: sessions } = await db.from('class_sessions').select('starts_at, title, status, dance_styles(slug), instructors(full_name)')
    .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).eq('status', 'scheduled').order('starts_at');
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date(iso));
  const lines = ((sessions ?? []) as unknown as { starts_at: string; title: string; dance_styles: { slug: string } | null; instructors: { full_name: string } | null }[])
    .filter((x) => day(x.starts_at) === today)
    .map((x) => ({ time: fmt(x.starts_at), title: x.title, instructor: x.instructors?.full_name ?? null, style_slug: x.dance_styles?.slug ?? null }));
  const { data: row } = await db.from('assistant_stories').insert({
    story_date: today, title: lines.length ? 'TODAY AT DROP' : 'NO CLASSES TODAY', lines, art_slug: lines[0]?.style_slug ?? null, status: lines.length ? 'draft' : 'skipped',
  }).select().single();
  if (lines.length && row) await db.rpc('_assistant_notify', { p_kind: 'assistant_story', p_payload: { date: today, classes: lines.length }, p_key: `story:${today}` });
  return { created: row?.id ?? null, classes: lines.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const url = new URL(req.url);

  // Meta's one-time webhook check.
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === Deno.env.get('IG_VERIFY_TOKEN') && Deno.env.get('IG_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const db = adminClient();

  // Instagram webhook.
  const sig = req.headers.get('x-hub-signature-256');
  if (sig) {
    const raw = await req.text();
    if (!(await verifySignature(raw, sig, Deno.env.get('META_APP_SECRET') ?? ''))) return new Response('bad signature', { status: 401 });
    const events = parseWebhook(JSON.parse(raw), igConfig()?.userId);
    const work = (async () => { for (const ev of events) { try { await handleEvent(db, ev); } catch (e) { console.error('thamires event failed', (e as Error).message); } } })();
    await background(work);
    return new Response('ok');
  }

  // Scheduled daily Story.
  if (req.headers.get('x-cron-secret')) {
    if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
    return Response.json(await dailyStory(db));
  }

  // Admin actions from the Drop app.
  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);
  const { data: isAdmin } = await supa.rpc('is_admin');
  if (!isAdmin) return json(req, { error: 'forbidden' }, 403);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const actor = auth.user.id;
  try {
    switch (body.action) {
      case 'status':
        return json(req, { instagram: Boolean(igConfig()), claude: Boolean(Deno.env.get('ANTHROPIC_API_KEY')), webhook: Boolean(Deno.env.get('META_APP_SECRET') && Deno.env.get('IG_VERIFY_TOKEN')) });
      case 'test': {
        const turns = (Array.isArray(body.history) ? body.history : []) as Turn[];
        const who = (body.person ?? {}) as Person;
        const d = await draft(turns.filter((t) => typeof t?.text === 'string').slice(-20), turns.filter((t) => t.from !== 'member').length === 0, body.task === 'thanks' ? 'thanks' : 'dm', db, who);
        if (!d) return json(req, { error: 'claude_not_configured' }, 400);
        return json(req, d);
      }
      case 'send': {
        const text = String(body.text ?? '').trim();
        if (!text || text.length > 1000) return json(req, { error: 'invalid_text' }, 400);
        await sendDraft(db, String(body.message_id), text, actor);
        return json(req, { ok: true });
      }
      case 'reply': { // a reply typed by the team
        const text = String(body.text ?? '').trim();
        if (!text || text.length > 1000) return json(req, { error: 'invalid_text' }, 400);
        const { data: m } = await db.from('assistant_messages').insert({ thread_id: String(body.thread_id), direction: 'out', kind: 'dm', text, status: 'draft', reason: 'Written by the team' }).select().single();
        await sendDraft(db, m!.id, text, actor);
        await db.from('assistant_threads').update({ status: 'open' }).eq('id', String(body.thread_id));
        return json(req, { ok: true });
      }
      case 'thread_status':
        await db.from('assistant_threads').update({ status: String(body.status) }).eq('id', String(body.thread_id));
        return json(req, { ok: true });
      case 'mention_send': {
        const cfg = igConfig(); if (!cfg) return json(req, { error: 'Instagram is not connected yet.' }, 400);
        const text = String(body.text ?? '').trim();
        const { data: mn } = await db.from('assistant_mentions').select('*').eq('id', String(body.mention_id)).single();
        if (!mn || !text) return json(req, { error: 'not_found' }, 404);
        try {
          if (mn.kind === 'story') await ig.sendDm(cfg, mn.ig_user_id, text); else await ig.commentOnMention(cfg, mn.ig_media_id, text);
          await db.from('assistant_mentions').update({ reply_text: text, reply_status: 'sent', decided_by: actor, error: null }).eq('id', mn.id);
        } catch (e) {
          await db.from('assistant_mentions').update({ reply_status: 'failed', error: (e as Error).message, decided_by: actor }).eq('id', mn.id);
          throw e;
        }
        return json(req, { ok: true });
      }
      case 'mention_skip':
        await db.from('assistant_mentions').update({ reply_status: 'skipped', decided_by: actor }).eq('id', String(body.mention_id));
        return json(req, { ok: true });
      case 'story_prepare':
        return json(req, await dailyStory(db, true));
      case 'story_publish': {
        const cfg = igConfig(); if (!cfg) return json(req, { error: 'Instagram is not connected yet.' }, 400);
        const path = String(body.image_path ?? '');
        const { data: st } = await db.from('assistant_stories').select('*').eq('id', String(body.story_id)).single();
        if (!st || !path) return json(req, { error: 'not_found' }, 404);
        const publicUrl = db.storage.from('assistant-media').getPublicUrl(path).data.publicUrl;
        try {
          const r = await ig.publishStory(cfg, publicUrl);
          await db.from('assistant_stories').update({ status: 'published', image_path: path, ig_media_id: r.id, decided_by: actor, error: null }).eq('id', st.id);
        } catch (e) {
          await db.from('assistant_stories').update({ status: 'failed', image_path: path, error: (e as Error).message, decided_by: actor }).eq('id', st.id);
          throw e;
        }
        return json(req, { ok: true });
      }
      case 'story_skip':
        await db.from('assistant_stories').update({ status: 'skipped', decided_by: actor }).eq('id', String(body.story_id));
        return json(req, { ok: true });
      default:
        return json(req, { error: 'unknown_action' }, 400);
    }
  } catch (e) {
    return json(req, { error: (e as Error).message }, 400);
  }
});
