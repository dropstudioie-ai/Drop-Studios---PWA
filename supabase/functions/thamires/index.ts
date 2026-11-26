import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
// Thamires: Drop's AI assistant on Instagram.
// - Instagram webhooks (DMs, story mentions, post mentions): store, draft a reply, send it if auto mode allows.
// - Admin actions from the Drop app (approve/edit/send drafts, test her, publish the daily Story).
// - A scheduled call prepares the daily Story draft.
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';
import { blockedBySibling, canAutoSend, canAutoSendHolding, draftReply, summariseDay, type Draft, type Turn } from './brain.ts';
import { ig, igConfig, parseWebhook, verifySignature, type IgEvent } from './instagram.ts';
import { authorizeUrl, exchangeCode, publishStatus, refreshTokens, sendToDrafts, ttConfig, userInfo } from './tiktok.ts';
import { artworkFor, DROP_LOGO, photoSource, renderClassStory, renderWeekStory, type Assets, type StoryPhoto, type WeekDay } from './story_render.ts';

type Db = SupabaseClient;
// Keys that aren't tied to one Claude workspace need the workspace ID on every request.
const anthropic = () => {
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return null;
  const ws = Deno.env.get('ANTHROPIC_WORKSPACE_ID');
  return new Anthropic(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {});
};
const background = (p: Promise<unknown>) => {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt) rt.waitUntil(p); else return p;
};

async function settings(db: Db) {
  const { data } = await db.from('assistant_settings').select('*').single();
  return data as { enabled: boolean; auto_reply: boolean; auto_tag_thanks: boolean; daily_story: boolean; story_hour: number; daily_report: boolean; report_hour: number; auto_comment_reply: boolean; story_auto_publish: boolean; weekly_schedule: boolean; weekly_hour: number; weekly_days: number[] } | null;
}

/** Today's date and the current hour in Dublin. */
function dublinNow() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (t: string) => parts.find((p) => p.type === t)!.value;
  return { today: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
}

interface Person { username?: string | null; display_name?: string | null; language?: string | null; language_offered?: boolean; memory?: string | null; last_inbound_at?: string | null }
async function draft(history: Turn[], disclose: boolean, task: 'dm' | 'thanks' | 'comment', db: Db, who: Person = {}, followUp = false): Promise<Draft | null> {
  const client = anthropic();
  if (!client) return null;
  const { data: knowledge } = await db.rpc('assistant_knowledge');
  return draftReply({ client }, { history, knowledge, disclose, task, person: { username: who.username, name: who.display_name }, language: who.language, languageOffered: who.language_offered,
    memory: who.memory, followUp, daysSinceLastChat: who.last_inbound_at ? Math.floor((Date.now() - new Date(who.last_inbound_at).getTime()) / 864e5) : null });
}

/** Remember the language the conversation settled on, and that she offered to switch. */
async function rememberLanguage(db: Db, threadId: string, d: Draft, history: Turn[]) {
  const patch: Record<string, unknown> = {};
  if (d.offered_language) patch.language_offered = true;
  // Only lock in a language once the person has written in it (not just because she offered it).
  if (d.language && history.some((t) => t.from === 'member') && !d.offered_language) patch.language = d.language;
  if (d.memory) { patch.memory = d.memory; patch.memory_updated_at = new Date().toISOString(); }
  if (Object.keys(patch).length) await db.from('assistant_threads').update(patch).eq('id', threadId);
}

interface ThreadRow { id: string; disclosed: boolean; username: string | null; display_name: string | null; language: string | null; language_offered: boolean; memory: string | null; last_inbound_at: string | null }

async function thread(db: Db, igUserId: string): Promise<ThreadRow> {
  const { data: existing } = await db.from('assistant_threads').select('*').eq('ig_user_id', igUserId).maybeSingle();
  if (existing) return existing as ThreadRow;
  const cfg = igConfig();
  const prof = cfg ? await ig.profile(cfg, igUserId) : {};
  const { data } = await db.from('assistant_threads').upsert({ ig_user_id: igUserId, username: prof.username ?? null, display_name: prof.name ?? null }, { onConflict: 'ig_user_id' }).select().single();
  return data as { id: string; disclosed: boolean; username: string | null; display_name: string | null; language: string | null; language_offered: boolean; memory: string | null; last_inbound_at: string | null };
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

interface CommentRow { id: string; ig_comment_id: string; username: string | null; text: string; post_caption: string | null }

/** Thamires drafts a public reply to a comment under one of Drop's posts. */
async function draftComment(db: Db, row: CommentRow, followUp = false) {
  const caption = row.post_caption ? ` (post caption: "${row.post_caption.replace(/\s+/g, ' ').slice(0, 300)}")` : '';
  const d = await draft([{ from: 'member', text: `@${row.username ?? 'someone'} commented on Drop's post${caption}: ${row.text}` }], false, 'comment', db, { username: row.username }, followUp);
  if (!d) return null;
  await db.from('assistant_comments').update({
    reply_text: d.reply, reply_status: 'draft', needs_human: d.needs_human, out_of_ordinary: followUp ? false : d.out_of_ordinary,
    reason: d.reason, topic: d.topic, translation: d.translation_en || null,
  }).eq('id', row.id);
  return d;
}

async function sendComment(db: Db, id: string, text: string, actor: string | null) {
  const cfg = igConfig();
  if (!cfg) throw new Error('Instagram is not connected yet.');
  const { data: c } = await db.from('assistant_comments').select('id, ig_comment_id').eq('id', id).single();
  if (!c) throw new Error('not_found');
  try {
    const r = await ig.replyToComment(cfg, c.ig_comment_id, text);
    await db.from('assistant_comments').update({ reply_text: text, reply_status: 'sent', reply_id: r.id ?? null, decided_by: actor, error: null }).eq('id', id);
  } catch (e) {
    await db.from('assistant_comments').update({ reply_status: 'failed', error: (e as Error).message, decided_by: actor }).eq('id', id);
    throw e;
  }
}

/** Publish the day's Stories (one image per class) in order. A retry continues where it stopped, so nothing is posted twice. */
async function publishStories(db: Db, storyId: string, paths: string[], actor: string | null) {
  const cfg = igConfig();
  if (!cfg) throw new Error('Instagram is not connected yet.');
  const { data: st } = await db.from('assistant_stories').select('*').eq('id', storyId).single();
  if (!st || !paths.length || paths.length > 10) throw new Error('not_found');
  const done: string[] = st.status === 'failed' && Array.isArray(st.ig_media_ids) ? [...st.ig_media_ids] : [];
  for (let i = done.length; i < paths.length; i++) {
    try {
      const r = await ig.publishStory(cfg, db.storage.from('assistant-media').getPublicUrl(paths[i]).data.publicUrl);
      done.push(r.id);
    } catch (e) {
      await db.from('assistant_stories').update({ status: 'failed', image_paths: paths, ig_media_ids: done, error: `${done.length} of ${paths.length} posted: ${(e as Error).message}`, decided_by: actor }).eq('id', st.id);
      throw e;
    }
  }
  await db.from('assistant_stories').update({ status: 'published', image_paths: paths, image_path: paths[0], ig_media_ids: done, ig_media_id: done[0], decided_by: actor, error: null }).eq('id', st.id);
  return done;
}

interface PromoRow { id: string; title: string; items: { path: string; kind: 'image' | 'video'; label?: string }[]; every_days: number; post_hour: number; starts_on: string | null; ends_on: string | null; enabled: boolean; last_posted_on: string | null; progress: { date: string; ids: string[] } | null; posts_done: number; spacing_group: string | null; last_posted_at: string | null }

/** Post scheduled promo Stories that are due (in order; a run that stops part-way continues on the next hourly check). */
async function runPromos(db: Db, force?: string) {
  const s = await settings(db);
  const { today, hour } = dublinNow();
  const cfg = igConfig();
  if (!cfg) return { skipped: 'instagram_not_connected' };
  const { data } = await db.from('assistant_promos').select('*');
  const out: Record<string, unknown> = {};
  for (const p of (data ?? []) as PromoRow[]) {
    const midRun = p.progress?.date === today;
    const due = p.id === force || midRun || (p.enabled && s?.enabled && p.starts_on && today >= p.starts_on && (!p.ends_on || today <= p.ends_on)
      && hour >= p.post_hour && (!p.last_posted_on || (Date.parse(today) - Date.parse(p.last_posted_on)) / 864e5 >= p.every_days));
    if (!due || (p.last_posted_on === today && p.id !== force)) continue;
    if (!midRun && p.id !== force && blockedBySibling(p, (data ?? []) as PromoRow[], new Date(), today)) { out[p.title] = { waiting: 'sibling_on_display' }; continue; }
    const ids = midRun ? [...(p.progress?.ids ?? [])] : [];
    try {
      for (let i = ids.length; i < p.items.length; i++) {
        const it = p.items[i];
        const r = await ig.publishStory(cfg, db.storage.from('assistant-media').getPublicUrl(it.path).data.publicUrl, it.kind);
        ids.push(r.id);
        await db.from('assistant_promos').update({ progress: { date: today, ids } }).eq('id', p.id);
      }
      const postedAt = new Date().toISOString();
      p.last_posted_at = postedAt; p.progress = null;   // siblings later in this run see it
      await db.from('assistant_promos').update({ last_posted_on: today, last_posted_at: postedAt, progress: null, last_error: null, posts_done: p.posts_done + 1 }).eq('id', p.id);
      await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_promo', p_payload: { title: p.title, items: p.items.map((x) => x.label ?? x.kind), posts_done: p.posts_done + 1, ends_on: p.ends_on }, p_key: `promo:${p.id}:${today}` });
      out[p.title] = { posted: ids.length };
    } catch (e) {
      await db.from('assistant_promos').update({ last_error: `${ids.length} of ${p.items.length} posted: ${(e as Error).message}`.slice(0, 500) }).eq('id', p.id);
      out[p.title] = { error: (e as Error).message };
    }
  }
  return out;
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

  if (ev.type === 'reaction') { // someone reacted to one of Drop's messages
    await db.from('assistant_messages').update({ reaction: ev.emoji }).eq('ig_message_id', ev.mid);
    return;
  }
  if (ev.type === 'story_insights') {
    // A day can have several Stories (one per class): keep the numbers of the one that reached most people.
    const { data: st } = await db.from('assistant_stories').select('id, insights').contains('ig_media_ids', [ev.mediaId]).maybeSingle();
    const prev = (st?.insights ?? null) as Record<string, number> | null;
    if (st && (!prev || (ev.metrics.reach ?? 0) >= (prev.reach ?? 0))) await db.from('assistant_stories').update({ insights: ev.metrics, insights_at: new Date().toISOString() }).eq('id', st.id);
    else if (!st) await db.from('assistant_stories').update({ insights: ev.metrics, insights_at: new Date().toISOString() }).eq('ig_media_id', ev.mediaId);
    return;
  }
  if (ev.type === 'comment') {
    const media = cfg && ev.mediaId ? await ig.media(cfg, ev.mediaId) : {};
    const { data: row, error } = await db.from('assistant_comments').insert({
      ig_comment_id: ev.commentId, media_id: ev.mediaId, parent_id: ev.parentId, ig_user_id: ev.from, username: ev.username,
      text: ev.text.slice(0, 2000), post_caption: media.caption?.slice(0, 1000) ?? null, permalink: media.permalink ?? null,
    }).select().single();
    if (error || !row || !s?.enabled) return; // duplicate delivery or Thamires off
    const d = await draftComment(db, row as CommentRow);
    if (!d) return;
    if (d.out_of_ordinary) {
      const { data: g } = await db.from('assistant_guidance').insert({ question: d.question_en || ev.text.slice(0, 300), asked_text: ev.text.slice(0, 1000), comment_id: row.id }).select().single();
      await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_guidance', p_payload: { username: ev.username ?? 'someone', question: d.question_en || ev.text.slice(0, 200), asked: ev.text.slice(0, 200), where: 'comment' }, p_key: `guidance:${g?.id ?? row.id}` });
      return;
    }
    if (s.auto_comment_reply && canAutoSend(d)) {
      try { await sendComment(db, row.id, d.reply, null); return; } catch (e) { console.error('comment auto-reply failed', (e as Error).message); }
    }
    // Only bother you by email when a person is needed; the rest waits quietly on the Comments tab.
    if (d.needs_human) await db.rpc('_assistant_notify', { p_kind: 'assistant_comment', p_payload: { username: ev.username ?? 'someone', preview: ev.text.slice(0, 120) }, p_key: `comment:${row.id}` });
    return;
  }

  const t = await thread(db, ev.from);
  const text = ev.type === 'story_mention' ? '[Mentioned Drop in their Story]' : ev.text;
  const { error: dup } = await db.from('assistant_messages').insert({ thread_id: t.id, direction: 'in', kind: ev.type === 'message' ? 'dm' : ev.type, text, ig_message_id: ev.mid, status: 'received' });
  if (dup) return; // Instagram re-delivered the same message
  const previousInbound = t.last_inbound_at;
  await db.from('assistant_threads').update({ last_inbound_at: new Date().toISOString(), last_message_at: new Date().toISOString() }).eq('id', t.id);
  t.last_inbound_at = previousInbound;
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
  const { data: out } = await db.from('assistant_messages').insert({ thread_id: t.id, direction: 'out', kind: 'dm', text: d.reply, status: 'draft', needs_human: d.needs_human, reason: d.reason, translation: d.translation_en || null, topic: d.topic, out_of_ordinary: d.out_of_ordinary }).select().single();
  if (d.needs_human) await db.from('assistant_threads').update({ status: 'needs_human' }).eq('id', t.id);

  // Something new or unusual: ask the owner, and (with auto-replies on) tell the person she's checking.
  if (d.out_of_ordinary && out) {
    const { data: g } = await db.from('assistant_guidance').insert({ question: d.question_en || text.slice(0, 300), asked_text: text.slice(0, 1000), thread_id: t.id, message_id: out.id }).select().single();
    let holdingSent = false;
    if (s.auto_reply && canAutoSendHolding(d)) {
      try { await sendDraft(db, out.id, d.reply, null); holdingSent = true; } catch (e) { console.error('holding reply failed', (e as Error).message); }
    }
    await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_guidance', p_payload: { username: t.username ?? 'someone', question: d.question_en || text.slice(0, 200), asked: text.slice(0, 200), holding_sent: holdingSent }, p_key: `guidance:${g?.id ?? out.id}` });
    return;
  }

  if (s.auto_reply && canAutoSend(d) && out) {
    try { await sendDraft(db, out.id, d.reply, null); return; } catch (e) { console.error('auto-send failed', (e as Error).message); }
  }
  await db.rpc('_assistant_notify', { p_kind: 'assistant_draft', p_payload: { username: t.username ?? 'someone', preview: text.slice(0, 120), needs_human: d.needs_human }, p_key: `draft:${out?.id}` });
}

/** After the owner answers a question, Thamires rewrites her reply with the answer (waiting for approval). */
async function redraftWithGuidance(db: Db, threadId: string, messageId: string | null) {
  const { data: t } = await db.from('assistant_threads').select('*').eq('id', threadId).maybeSingle();
  if (!t) return null;
  const hist = await history(db, threadId);
  const d = await draft(hist, !t.disclosed, 'dm', db, t as ThreadRow, true);
  if (!d) return null;
  const row = { text: d.reply, needs_human: d.needs_human, reason: d.reason, translation: d.translation_en || null, topic: d.topic, out_of_ordinary: false };
  const { data: src } = messageId ? await db.from('assistant_messages').select('id, status').eq('id', messageId).maybeSingle() : { data: null };
  if (src?.status === 'draft') await db.from('assistant_messages').update(row).eq('id', src.id);
  else await db.from('assistant_messages').insert({ thread_id: threadId, direction: 'out', kind: 'dm', status: 'draft', ...row });
  if (!d.needs_human) await db.from('assistant_threads').update({ status: 'open' }).eq('id', threadId);
  return d;
}

/** The owner's daily report: what people talked about, new questions, and what's waiting. */
async function dailyReport(db: Db, force = false) {
  const s = await settings(db);
  if (!force && (!s?.enabled || !s.daily_report)) return { skipped: 'off' };
  const { today, hour } = dublinNow();
  if (!force && hour < (s?.report_hour ?? 21)) return { skipped: 'too_early' };
  if (!force) {
    const { data: existing } = await db.from('assistant_reports').select('id').eq('report_date', today).maybeSingle();
    if (existing) return { skipped: 'exists' };
  }
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const [comments, reactions, lastStory] = await Promise.all([
    db.from('assistant_comments').select('text, reply_status').gte('received_at', since).limit(1000),
    db.from('assistant_messages').select('reaction').not('reaction', 'is', null).gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()),
    db.from('assistant_stories').select('story_date, insights').eq('status', 'published').not('insights', 'is', null).order('story_date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const [msgs, threads, questions, openQ, waiting, tags, story] = await Promise.all([
    db.from('assistant_messages').select('direction, status, text, topic, needs_human, decided_by, thread_id').gte('created_at', since).limit(2000),
    db.from('assistant_threads').select('id', { count: 'exact', head: true }).gte('created_at', since),
    db.from('assistant_guidance').select('question, status').gte('created_at', since).order('created_at'),
    db.from('assistant_guidance').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    db.from('assistant_messages').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    db.from('assistant_mentions').select('id', { count: 'exact', head: true }).gte('received_at', since),
    db.from('assistant_stories').select('status').eq('story_date', today).maybeSingle(),
  ]);
  type M = { direction: string; status: string; text: string; topic: string | null; needs_human: boolean; decided_by: string | null; thread_id: string };
  const all = (msgs.data ?? []) as M[];
  const inbound = all.filter((m) => m.direction === 'in' && m.text && !m.text.startsWith('['));
  const out = all.filter((m) => m.direction === 'out');
  const topics: Record<string, number> = {};
  for (const m of out) if (m.topic) topics[m.topic] = (topics[m.topic] ?? 0) + 1;
  const stats = {
    messages_in: inbound.length,
    people: new Set(inbound.map((m) => m.thread_id)).size,
    new_people: threads.count ?? 0,
    replies_sent: out.filter((m) => m.status === 'sent').length,
    auto_sent: out.filter((m) => m.status === 'sent' && !m.decided_by).length,
    handed_to_you: out.filter((m) => m.needs_human).length,
    waiting: waiting.count ?? 0,
    tags: tags.count ?? 0,
    story: (story.data as { status?: string } | null)?.status ?? 'none',
    topics,
    new_questions: ((questions.data ?? []) as { question: string; status: string }[]).map((q) => ({ question: q.question, answered: q.status === 'answered' })),
    open_questions: openQ.count ?? 0,
    comments: (comments.data ?? []).length,
    comments_replied: ((comments.data ?? []) as { reply_status: string }[]).filter((c) => c.reply_status === 'sent').length,
    comments_waiting: ((comments.data ?? []) as { reply_status: string }[]).filter((c) => c.reply_status === 'draft').length,
    reactions_week: (reactions.data ?? []).length,
    last_story: lastStory.data ? { date: (lastStory.data as { story_date: string }).story_date, ...((lastStory.data as { insights: Record<string, number> }).insights ?? {}) } : null,
  };
  const client = anthropic();
  const said = [...inbound.map((m) => m.text), ...((comments.data ?? []) as { text: string }[]).map((c) => `(comment on a post) ${c.text}`)];
  const sum = client ? await summariseDay({ client }, said.slice(-200)) : null;
  const report = { report_date: today, stats, summary: sum?.summary ?? null, themes: sum?.themes ?? [], suggestions: sum?.suggestions ?? [] };
  const { data: row } = await db.from('assistant_reports').upsert(report, { onConflict: 'report_date' }).select().single();
  await db.rpc('_assistant_notify_owner', {
    p_kind: 'assistant_report',
    p_payload: { date: today, ...stats, summary: report.summary, themes: report.themes, suggestions: report.suggestions },
    p_key: force ? `report:${today}:${Date.now()}` : `report:${today}`,
  });
  return { created: row?.id ?? null, ...stats };
}

/** Prepare today's Story from the timetable (rendered and published from the admin page). */
async function dailyStory(db: Db, force = false) {
  const s = await settings(db);
  if (!force && (!s?.enabled || !s.daily_story)) return { skipped: 'off' };
  const { today, hour } = dublinNow();
  if (!force && hour < (s?.story_hour ?? 10)) return { skipped: 'too_early' };
  const { data: existing } = await db.from('assistant_stories').select('id').eq('story_date', today).maybeSingle();
  if (existing) return { skipped: 'exists' };
  const start = new Date(`${today}T00:00:00Z`); const end = new Date(start.getTime() + 36 * 3600e3);
  const { data: sessions } = await db.from('class_sessions').select('starts_at, title, status, instructor_id, dance_styles(slug), instructors(full_name)')
    .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).eq('status', 'scheduled').order('starts_at');
  const fmt = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date(iso));
  const lines = ((sessions ?? []) as unknown as { starts_at: string; title: string; instructor_id: string | null; dance_styles: { slug: string } | null; instructors: { full_name: string } | null }[])
    .filter((x) => day(x.starts_at) === today)
    .map((x) => ({ time: fmt(x.starts_at), title: x.title, instructor: x.instructors?.full_name ?? null, style_slug: x.dance_styles?.slug ?? null, instructor_id: x.instructor_id, starts_at: x.starts_at }));
  const { data: row } = await db.from('assistant_stories').insert({
    story_date: today, title: lines.length ? 'TODAY AT DROP' : 'NO CLASSES TODAY', lines, art_slug: lines[0]?.style_slug ?? null, status: lines.length ? 'draft' : 'skipped',
  }).select().single();
  if (!lines.length || !row) return { created: row?.id ?? null, classes: 0 };
  if (!force && s?.story_auto_publish) {
    const posted = await publishStoryServer(db, row.id, null);
    return { created: row.id, classes: lines.length, posted };
  }
  await db.rpc('_assistant_notify', { p_kind: 'assistant_story', p_payload: { date: today, classes: lines.length }, p_key: `story:${today}` });
  return { created: row.id, classes: lines.length };
}

// ---------- Stories drawn on the server (so Thamires can post on her own) ----------

const ASSET_BASE = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/assistant-media/assets/`;
const assetCache = new Map<string, Promise<Uint8Array>>();
const fetchBytes = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url.split('/').slice(-2).join('/')} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
};
const assets: Assets = {
  get: (path) => {
    if (!assetCache.has(path)) assetCache.set(path, fetchBytes(ASSET_BASE + path).catch((e) => { assetCache.delete(path); throw e; }));
    return assetCache.get(path)!;
  },
};

interface StoryLine { time: string; title: string; instructor: string | null; style_slug: string | null; instructor_id?: string | null; starts_at?: string }
interface StoryRow { id: string; story_date: string; lines: StoryLine[]; photo_url: string | null; photos: Record<string, string> | null; status: string; ig_media_ids: string[] | null }

/** The photo for one class's Story: the admin's choice, else the class artwork, else a studio photo. */
async function photoFor(st: StoryRow, index: number): Promise<StoryPhoto> {
  const chosen = st.photos?.[String(index)] ?? (index === 0 ? st.photo_url : null);
  const l = st.lines[index];
  if (chosen) {
    const src = photoSource(chosen);
    if ('url' in src) return { kind: 'photo', image: await fetchBytes(src.url) };
    return src.asset.startsWith('classes/')
      ? { kind: 'artwork', image: await assets.get(`${src.asset}.jpg`), blurred: await assets.get(`${src.asset}-blur.jpg`) }
      : { kind: 'photo', image: await assets.get(`${src.asset}.jpg`) };
  }
  const art = artworkFor(l.style_slug, l.instructor_id ?? null, st.story_date);
  return art ? { kind: 'artwork', image: await assets.get(`${art}.jpg`), blurred: await assets.get(`${art}-blur.jpg`) } : { kind: 'photo', image: await assets.get('studio/photo-19.jpg') };
}

async function renderFrame(db: Db, storyId: string, index: number) {
  const { data } = await db.from('assistant_stories').select('*').eq('id', storyId).single();
  const st = data as StoryRow;
  if (!st || !st.lines[index]) throw new Error('not_found');
  return renderClassStory(assets, { date: st.story_date, cls: st.lines[index], photo: await photoFor(st, index), logo: DROP_LOGO });
}

/** Ask a fresh copy of this function to do one heavy job (drawing is limited to ~2s of CPU per request). */
async function selfInvoke(job: Record<string, unknown>) {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/thamires`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron-secret': Deno.env.get('CRON_SECRET') ?? '' }, body: JSON.stringify(job),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || body.error) throw new Error(body.error ?? `job failed (${r.status})`);
  return body;
}

/** Draw, upload and publish one class's Story (run in its own request). */
async function publishFrame(db: Db, storyId: string, index: number) {
  const cfg = igConfig(); if (!cfg) throw new Error('Instagram is not connected yet.');
  const png = await renderFrame(db, storyId, index);
  const path = `stories/${storyId}-${index + 1}-${Date.now()}.png`;
  const up = await db.storage.from('assistant-media').upload(path, png, { contentType: 'image/png' });
  if (up.error) throw new Error(up.error.message);
  const r = await ig.publishStory(cfg, db.storage.from('assistant-media').getPublicUrl(path).data.publicUrl);
  return { id: r.id, path };
}

/** Publish all of a day's class Stories in time order; a retry continues where it stopped. */
async function publishStoryServer(db: Db, storyId: string, actor: string | null) {
  const { data } = await db.from('assistant_stories').select('*').eq('id', storyId).single();
  const st = data as StoryRow;
  if (!st) throw new Error('not_found');
  const ids = st.status === 'failed' && Array.isArray(st.ig_media_ids) ? [...st.ig_media_ids] : [];
  const paths: string[] = [];
  for (let i = ids.length; i < st.lines.length; i++) {
    try {
      const r = await selfInvoke({ job: 'story_frame', story_id: storyId, index: i });
      ids.push(r.id); paths.push(r.path);
      await db.from('assistant_stories').update({ ig_media_ids: ids }).eq('id', storyId);
    } catch (e) {
      await db.from('assistant_stories').update({ status: 'failed', ig_media_ids: ids, error: `${ids.length} of ${st.lines.length} posted: ${(e as Error).message}`, decided_by: actor }).eq('id', storyId);
      await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_story', p_payload: { date: st.story_date, classes: st.lines.length, failed: (e as Error).message }, p_key: `story-failed:${st.story_date}:${ids.length}` });
      return { posted: ids.length, error: (e as Error).message };
    }
  }
  await db.from('assistant_stories').update({ status: 'published', ig_media_ids: ids, ig_media_id: ids[0] ?? null, image_path: paths[0] ?? null, image_paths: paths, error: null, decided_by: actor }).eq('id', storyId);
  await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_story', p_payload: { date: st.story_date, classes: st.lines.length, posted: true }, p_key: `story-posted:${st.story_date}` });
  return { posted: ids.length };
}

/** The Monday of the week after `date` (Fri/Sat/Sun -> the coming Monday). */
function nextMonday(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  return new Date(d.getTime() + add * 864e5).toISOString().slice(0, 10);
}

async function weekData(db: Db, weekStart: string): Promise<WeekDay[]> {
  const from = new Date(`${weekStart}T00:00:00Z`).getTime() - 3 * 3600e3, to = from + 8 * 864e5;
  const { data } = await db.from('class_sessions').select('id, starts_at, title, instructors(full_name), studio_events(title, status)')
    .gte('starts_at', new Date(from).toISOString()).lt('starts_at', new Date(to).toISOString()).eq('status', 'scheduled').order('starts_at');
  const key = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Dublin' }).format(new Date(iso));
  const hm = (iso: string) => new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const rows = (data ?? []) as unknown as { starts_at: string; title: string; instructors: { full_name: string } | null; studio_events: { title: string; status: string }[] | null }[];
  return Array.from({ length: 7 }, (_, k) => {
    const date = new Date(Date.parse(`${weekStart}T12:00:00Z`) + k * 864e5).toISOString().slice(0, 10);
    return { date, items: rows.filter((r) => key(r.starts_at) === date).map((r) => ({ time: hm(r.starts_at), title: r.title, instructor: r.instructors?.full_name ?? null,
      special: r.studio_events?.find((e) => e.status === 'published')?.title ?? null })) };
  });
}

const renderWeek = async (db: Db, weekStart: string) =>
  renderWeekStory(assets, { weekStart, days: await weekData(db, weekStart), background: await assets.get('studio/photo-19-blur.jpg'), logo: DROP_LOGO });

/** Friday, Saturday and Sunday evenings: next week's timetable on one Story. */
async function weeklyStory(db: Db, force = false) {
  const s = await settings(db);
  const { today, hour } = dublinNow();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (!force && (!s?.enabled || !s.weekly_schedule || !(s.weekly_days ?? [5, 6, 0]).includes(weekday) || hour < (s.weekly_hour ?? 18))) return { skipped: 'not_now' };
  const { data: done } = await db.from('assistant_weekly').select('id, status').eq('post_date', today).maybeSingle();
  if (done && done.status === 'published' && !force) return { skipped: 'exists' };
  return selfInvoke({ job: 'week_post', date: today });
}

async function postWeek(db: Db, date: string) {
  const cfg = igConfig(); if (!cfg) throw new Error('Instagram is not connected yet.');
  const weekStart = nextMonday(date);
  const days = await weekData(db, weekStart);
  const classes = days.reduce((n, d) => n + d.items.length, 0);
  const { data: row } = await db.from('assistant_weekly').upsert({ post_date: date, week_start: weekStart, status: 'posting', error: null }, { onConflict: 'post_date' }).select().single();
  try {
    const png = await renderWeekStory(assets, { weekStart, days, background: await assets.get('studio/photo-19-blur.jpg'), logo: DROP_LOGO });
    const path = `weekly/${weekStart}-${date}.png`;
    const up = await db.storage.from('assistant-media').upload(path, png, { contentType: 'image/png', upsert: true });
    if (up.error) throw new Error(up.error.message);
    const r = await ig.publishStory(cfg, db.storage.from('assistant-media').getPublicUrl(path).data.publicUrl);
    await db.from('assistant_weekly').update({ status: 'published', image_path: path, ig_media_id: r.id, classes }).eq('id', row.id);
    await db.rpc('_assistant_notify_owner', { p_kind: 'assistant_week', p_payload: { week_start: weekStart, classes, specials: days.reduce((n, d) => n + d.items.filter((i) => i.special).length, 0) }, p_key: `week:${date}` });
    return { ok: true, id: r.id, classes };
  } catch (e) {
    await db.from('assistant_weekly').update({ status: 'failed', error: (e as Error).message }).eq('id', row.id);
    return { error: (e as Error).message };
  }
}

// ---- TikTok -------------------------------------------------------------
const SITE = Deno.env.get('SITE_URL') || 'https://www.dropstudios.ie';
const ttBack = (msg: string) => Response.redirect(`${SITE}/admin/thamires?tiktok=${encodeURIComponent(msg)}#tiktok`, 302);

/** TikTok sends the owner back here after they approve Drop's account. */
async function tiktokCallback(db: Db, url: URL) {
  const cfg = ttConfig();
  if (!cfg) return ttBack('not_configured');
  if (url.searchParams.get('error')) return ttBack('cancelled');
  const state = url.searchParams.get('state') ?? '', code = url.searchParams.get('code') ?? '';
  const { data: st } = await db.from('tiktok_login_states').delete().eq('state', state).gte('created_at', new Date(Date.now() - 15 * 60e3).toISOString()).select().maybeSingle();
  if (!st || !code) return ttBack('expired');
  try {
    const t = await exchangeCode(cfg, code);
    const me = await userInfo(t.access_token).catch(() => ({ open_id: t.open_id } as { open_id: string; display_name?: string; avatar_url?: string }));
    await db.from('tiktok_connection').upsert({
      id: true, open_id: t.open_id, display_name: me.display_name ?? null, avatar_url: me.avatar_url ?? null,
      access_token: t.access_token, refresh_token: t.refresh_token, scope: t.scope,
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString(),
      connected_by: (st as { created_by: string | null }).created_by, connected_at: new Date().toISOString(),
    });
    return ttBack('connected');
  } catch (e) {
    console.error('tiktok connect failed', (e as Error).message);
    return ttBack('failed');
  }
}

/** A valid access token for Drop's account, refreshed when it's about to run out. */
async function tiktokToken(db: Db) {
  const cfg = ttConfig();
  if (!cfg) throw new Error('tiktok_not_configured');
  const { data: c } = await db.from('tiktok_connection').select('*').maybeSingle();
  if (!c) throw new Error('tiktok_not_connected');
  if (Date.parse(c.access_expires_at) > Date.now() + 5 * 60e3) return c.access_token as string;
  if (Date.parse(c.refresh_expires_at) <= Date.now()) throw new Error('tiktok_reconnect');
  const t = await refreshTokens(cfg, c.refresh_token);
  await db.from('tiktok_connection').update({
    access_token: t.access_token, refresh_token: t.refresh_token,
    access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + t.refresh_expires_in * 1000).toISOString(),
  }).eq('id', true);
  return t.access_token;
}

async function tiktokSend(db: Db, path: string, label: string | null, caption: string | null, actor: string | null) {
  const token = await tiktokToken(db);
  const { data: row } = await db.from('tiktok_posts').insert({ path, label, caption, sent_by: actor }).select('id').single();
  try {
    const file = await db.storage.from('assistant-media').download(path);
    if (file.error || !file.data) throw new Error('Video not found in Drop’s media');
    const publishId = await sendToDrafts(token, new Uint8Array(await file.data.arrayBuffer()));
    let status = 'sending';
    for (let i = 0; i < 10; i++) {   // TikTok processes the upload, then puts it in the inbox
      await new Promise((r) => setTimeout(r, 3000));
      const st = await publishStatus(token, publishId).catch(() => null);
      if (st?.status === 'SEND_TO_USER_INBOX' || st?.status === 'PUBLISH_COMPLETE') { status = 'in_drafts'; break; }
      if (st?.status === 'FAILED') throw new Error(`TikTok: ${st.fail_reason ?? 'upload failed'}`);
    }
    await db.from('tiktok_posts').update({ publish_id: publishId, status }).eq('id', row!.id);
    return { id: row!.id, publish_id: publishId, status };
  } catch (e) {
    await db.from('tiktok_posts').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', row!.id);
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname.endsWith('/tiktok/callback')) return tiktokCallback(adminClient(), url);

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
    const ok = await verifySignature(raw, sig, Deno.env.get('META_APP_SECRET') ?? '');
    let body: { object?: string; entry?: { messaging?: unknown[]; changes?: { field?: string }[] }[] } = {};
    try { body = JSON.parse(raw); } catch { /* logged below */ }
    const fields = [...new Set((body.entry ?? []).flatMap((e) => [...(e.messaging?.length ? ['messages'] : []), ...(e.changes ?? []).map((c) => c.field ?? '?')]))];
    const events = ok ? parseWebhook(body as never, igConfig()?.userId) : [];
    await db.from('assistant_webhook_log').insert({ signature_ok: ok, object: body.object ?? null, fields, events: events.length });
    if (!ok) return new Response('bad signature', { status: 401 });
    const work = (async () => { for (const ev of events) { try { await handleEvent(db, ev); } catch (e) { console.error('thamires event failed', (e as Error).message); } } })();
    await background(work);
    return new Response('ok');
  }

  // Scheduled daily Story.
  if (req.headers.get('x-cron-secret')) {
    if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return new Response('forbidden', { status: 403 });
    const job = await req.json().catch(() => ({})) as { check?: boolean; test?: string; name?: string; publish_story?: { story_id: string; image_path?: string; image_paths?: string[] }; job?: string; story_id?: string; index?: number; date?: string };
    // Heavy single jobs (one Story drawing each), started by Thamires herself.
    if (job.job === 'story_frame') {
      try { return Response.json(await publishFrame(db, String(job.story_id), Number(job.index))); }
      catch (e) { return Response.json({ error: (e as Error).message }); }
    }
    if (job.job === 'week_post') return Response.json(await postWeek(db, String(job.date)));
    if (job.job === 'render_frame' || job.job === 'render_week') {
      try {
        const png = job.job === 'render_frame' ? await renderFrame(db, String(job.story_id), Number(job.index)) : await renderWeek(db, String(job.date));
        return Response.json({ png: `data:image/png;base64,${encodeBase64(png)}` });
      } catch (e) { return Response.json({ error: (e as Error).message }); }
    }
    if (job.publish_story) { // publish already rendered Story images (developer, cron secret only)
      const { story_id, image_path, image_paths } = job.publish_story;
      try { return Response.json({ ok: true, ig_media_ids: await publishStories(db, story_id, image_paths ?? [image_path!], null) }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }
    if (typeof job.test === 'string') { // private test reply (nothing is sent to Instagram)
      const d = await draft([{ from: 'member', text: job.test.slice(0, 500) }], true, 'dm', db, { display_name: job.name ?? null });
      return Response.json(d ?? { error: 'claude_not_configured' });
    }
    if (job.check) { // connection check, run by the developer with the cron secret
      const cfg = igConfig();
      return Response.json({ configured: Boolean(cfg), claude: Boolean(Deno.env.get('ANTHROPIC_API_KEY')), app_secret: Boolean(Deno.env.get('META_APP_SECRET')),
        instagram: cfg ? await ig.check(cfg).catch((e) => ({ error: (e as Error).message })) : null });
    }
    const story = await dailyStory(db).catch((e) => ({ error: (e as Error).message }));
    const report = await dailyReport(db).catch((e) => ({ error: (e as Error).message }));
    const promos = await runPromos(db).catch((e) => ({ error: (e as Error).message }));
    const weekly = await weeklyStory(db).catch((e) => ({ error: (e as Error).message }));
    return Response.json({ story, report, promos, weekly });
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
        return json(req, { instagram: Boolean(igConfig()), account: igConfig() ? await ig.check(igConfig()!).then((r) => r.account.username ?? null).catch(() => null) : null, claude: Boolean(Deno.env.get('ANTHROPIC_API_KEY')), webhook: Boolean(Deno.env.get('META_APP_SECRET') && Deno.env.get('IG_VERIFY_TOKEN')) });
      case 'tiktok_status': {
        const { data: c } = await db.from('tiktok_connection').select('display_name, avatar_url, open_id, connected_at, refresh_expires_at').maybeSingle();
        return json(req, { configured: Boolean(ttConfig()), connected: c ? { display_name: c.display_name, avatar_url: c.avatar_url, connected_at: c.connected_at, reconnect_by: c.refresh_expires_at } : null });
      }
      case 'tiktok_connect': {
        const cfg = ttConfig();
        if (!cfg) return json(req, { error: 'tiktok_not_configured' }, 400);
        const state = crypto.randomUUID();
        await db.from('tiktok_login_states').insert({ state, created_by: actor });
        return json(req, { url: authorizeUrl(cfg, state) });
      }
      case 'tiktok_disconnect':
        await db.from('tiktok_connection').delete().eq('id', true);
        return json(req, { ok: true });
      case 'tiktok_send':
        return json(req, await tiktokSend(db, String(body.path), body.label ? String(body.label) : null, body.caption ? String(body.caption).slice(0, 2200) : null, actor));
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
      case 'forget': // clear what Thamires remembers about someone
        await db.from('assistant_threads').update({ memory: null, memory_updated_at: null }).eq('id', String(body.thread_id));
        return json(req, { ok: true });
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
      case 'story_publish': { // one image per class, in order
        const paths = (Array.isArray(body.image_paths) ? body.image_paths : [body.image_path]).map(String).filter(Boolean);
        const ids = await publishStories(db, String(body.story_id), paths, actor);
        return json(req, { ok: true, published: ids.length });
      }
      case 'guide': { // the owner answers an out-of-the-ordinary question
        const answer = String(body.answer ?? '').trim();
        if (!answer || answer.length > 2000) return json(req, { error: 'invalid_text' }, 400);
        const { data: before } = await db.from('assistant_guidance').select('*').eq('id', String(body.guidance_id)).single();
        if (!before) return json(req, { error: 'not_found' }, 404);
        await db.from('assistant_guidance').update({ answer, status: 'answered', answered_at: new Date().toISOString(), answered_by: actor }).eq('id', before.id);
        // First answer to a waiting question: Thamires rewrites her reply with it, for you to approve.
        let d: Draft | null = null;
        if (before.status === 'open' && before.comment_id) {
          const { data: c } = await db.from('assistant_comments').select('*').eq('id', before.comment_id).maybeSingle();
          if (c && c.reply_status !== 'sent') d = await draftComment(db, c as CommentRow, true);
        } else if (before.status === 'open' && before.thread_id) d = await redraftWithGuidance(db, before.thread_id, before.message_id);
        return json(req, { ok: true, redrafted: Boolean(d) });
      }
      case 'guidance_dismiss': // not worth an answer, or no longer true: Thamires stops using it
        await db.from('assistant_guidance').update({ status: 'dismissed', answered_by: actor }).eq('id', String(body.guidance_id));
        return json(req, { ok: true });
      case 'comment_send': {
        const text = String(body.text ?? '').trim();
        if (!text || text.length > 1000) return json(req, { error: 'invalid_text' }, 400);
        await sendComment(db, String(body.comment_id), text, actor);
        return json(req, { ok: true });
      }
      case 'comment_skip':
        await db.from('assistant_comments').update({ reply_status: 'skipped', decided_by: actor }).eq('id', String(body.comment_id));
        return json(req, { ok: true });
      case 'story_preview': // one class's Story, drawn exactly as it will be posted
        return json(req, await selfInvoke({ job: 'render_frame', story_id: String(body.story_id), index: Number(body.index ?? 0) }));
      case 'week_preview': {
        const { today } = dublinNow();
        return json(req, { ...(await selfInvoke({ job: 'render_week', date: nextMonday(today) })), week_start: nextMonday(today) });
      }
      case 'story_publish_server':
        return json(req, await publishStoryServer(db, String(body.story_id), actor));
      case 'week_post_now':
        return json(req, await weeklyStory(db, true));
      case 'promo_post_now':
        return json(req, await runPromos(db, String(body.promo_id)));
      case 'report_now':
        return json(req, await dailyReport(db, true));
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
