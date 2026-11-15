// Instagram (Meta Graph API) for Thamires: webhook verification and parsing, sending DMs,
// commenting on posts that mention Drop, and publishing Stories.
// Endpoint details are kept in this one file so they can be adjusted to the account's Meta setup.

// Drop uses the "Instagram API with Facebook Login" setup: calls go to graph.facebook.com with a
// long-lived Page access token for the Facebook Page linked to Drop's Instagram account.
//   IG_USER_ID      Drop's Instagram professional account ID
//   IG_PAGE_ID      the linked Facebook Page ID (DMs are sent through the Page)
//   IG_ACCESS_TOKEN the Page access token
// IG_GRAPH_BASE can point at graph.instagram.com instead for the Instagram Login setup (then IG_PAGE_ID is not needed).
export interface IgConfig { base: string; userId: string; pageId: string | null; token: string }

export const DEFAULT_GRAPH_BASE = 'https://graph.facebook.com/v27.0';

export function igConfig(): IgConfig | null {
  const userId = Deno.env.get('IG_USER_ID'), token = Deno.env.get('IG_ACCESS_TOKEN');
  if (!userId || !token) return null;
  return { base: Deno.env.get('IG_GRAPH_BASE') || DEFAULT_GRAPH_BASE, userId, pageId: Deno.env.get('IG_PAGE_ID') || null, token };
}

/** Where DMs are sent: the Page with Facebook Login, the Instagram account with Instagram Login. */
export const messagesPath = (cfg: IgConfig) => `${cfg.pageId ?? cfg.userId}/messages`;

/** Meta signs every webhook with the app secret (X-Hub-Signature-256: sha256=<hex>). */
export async function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export type IgEvent =
  | { type: 'message'; from: string; mid: string; text: string }
  | { type: 'story_mention'; from: string; mid: string; url: string | null }
  | { type: 'story_reply'; from: string; mid: string; text: string }
  | { type: 'post_mention'; mediaId: string; commentId: string | null }
  | { type: 'comment'; commentId: string; mediaId: string | null; parentId: string | null; from: string | null; username: string | null; text: string }
  | { type: 'reaction'; from: string; mid: string; emoji: string | null }
  | { type: 'story_insights'; mediaId: string; metrics: Record<string, number> };

interface Messaging { sender?: { id?: string }; recipient?: { id?: string }; reaction?: { mid?: string; action?: string; emoji?: string; reaction?: string }; message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; reply_to?: { story?: unknown }; attachments?: { type?: string; payload?: { url?: string } }[] } }
interface WebhookBody { object?: string; entry?: { id?: string; messaging?: Messaging[]; changes?: { field?: string; value?: ChangeValue }[] }[] }
interface ChangeValue { media_id?: string; comment_id?: string; id?: string; text?: string; parent_id?: string; from?: { id?: string; username?: string }; media?: { id?: string }; [metric: string]: unknown }

/** Turn a webhook payload into the events Thamires handles. Echoes of our own messages are ignored. */
export function parseWebhook(body: WebhookBody, ownId?: string): IgEvent[] {
  const out: IgEvent[] = [];
  if (body?.object !== 'instagram') return out;
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message, from = m.sender?.id;
      if (m.reaction?.mid && from && from !== ownId && from !== entry.id) {
        out.push({ type: 'reaction', from, mid: m.reaction.mid, emoji: m.reaction.action === 'unreact' ? null : (m.reaction.emoji ?? m.reaction.reaction ?? '❤️') });
        continue;
      }
      if (!msg?.mid || !from || msg.is_echo || msg.is_deleted || from === ownId || from === entry.id) continue;
      const mention = msg.attachments?.find((a) => a.type === 'story_mention');
      if (mention) out.push({ type: 'story_mention', from, mid: msg.mid, url: mention.payload?.url ?? null });
      else if (msg.reply_to?.story && msg.text) out.push({ type: 'story_reply', from, mid: msg.mid, text: msg.text });
      else if (msg.text) out.push({ type: 'message', from, mid: msg.mid, text: msg.text });
    }
    for (const c of entry.changes ?? []) {
      const v = c.value;
      if (c.field === 'mentions' && v?.media_id) out.push({ type: 'post_mention', mediaId: v.media_id, commentId: v.comment_id ?? null });
      // Comments on Drop's posts (ignore Drop's own comments, including Thamires' replies).
      if (c.field === 'comments' && v?.id && v.from?.id !== ownId && v.from?.id !== entry.id) {
        out.push({ type: 'comment', commentId: v.id, mediaId: v.media?.id ?? null, parentId: v.parent_id ?? null, from: v.from?.id ?? null, username: v.from?.username ?? null, text: String(v.text ?? '') });
      }
      if (c.field === 'story_insights' && v?.media_id) {
        const metrics: Record<string, number> = {};
        for (const [k, n] of Object.entries(v)) if (k !== 'media_id' && typeof n === 'number') metrics[k] = n;
        out.push({ type: 'story_insights', mediaId: v.media_id, metrics });
      }
    }
  }
  return out;
}

async function graph<T>(cfg: IgConfig, path: string, init: { method?: string; params?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const url = new URL(`${cfg.base}/${path}`);
  for (const [k, v] of Object.entries(init.params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${cfg.token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message ?? `Instagram error ${res.status}`);
  return data as T;
}

export const ig = {
  /** Reply in a DM (allowed within 24 hours of the person's last message). */
  sendDm: (cfg: IgConfig, to: string, text: string) =>
    graph<{ message_id?: string }>(cfg, messagesPath(cfg), { method: 'POST', body: { recipient: { id: to }, message: { text } } }),
  profile: (cfg: IgConfig, igsid: string) =>
    graph<{ username?: string; name?: string }>(cfg, igsid, { params: { fields: 'username,name' } }).catch(() => ({} as { username?: string; name?: string })),
  /** Details of a post that mentions Drop. */
  mentionedMedia: (cfg: IgConfig, mediaId: string) =>
    graph<{ mentioned_media?: { username?: string; permalink?: string; caption?: string; media_url?: string } }>(cfg, cfg.userId, {
      params: { fields: `mentioned_media.media_id(${mediaId}){username,permalink,caption,media_url}` },
    }).then((r) => r.mentioned_media ?? {}).catch(() => ({} as { username?: string; permalink?: string; caption?: string; media_url?: string })),
  /** Comment on a post that mentions Drop. */
  commentOnMention: (cfg: IgConfig, mediaId: string, text: string) =>
    graph<{ id?: string }>(cfg, `${cfg.userId}/mentions`, { method: 'POST', params: { media_id: mediaId, message: text } }),
  /** Connection check: who the token belongs to and whether the account sends webhooks to this app (read-only). */
  check: async (cfg: IgConfig) => {
    const me = await graph<{ id?: string; username?: string; name?: string }>(cfg, cfg.userId, { params: { fields: 'id,username,name' } });
    const subs = await graph<{ data?: { subscribed_fields?: string[] }[] }>(cfg, `${cfg.userId}/subscribed_apps`).catch((e) => ({ error: (e as Error).message }));
    return { account: me, subscriptions: subs };
  },
  /** Caption and link of one of Drop's posts. */
  media: (cfg: IgConfig, mediaId: string) =>
    graph<{ caption?: string; permalink?: string }>(cfg, mediaId, { params: { fields: 'caption,permalink' } }).catch(() => ({} as { caption?: string; permalink?: string })),
  /** Reply publicly to a comment on Drop's post. */
  replyToComment: (cfg: IgConfig, commentId: string, text: string) =>
    graph<{ id?: string }>(cfg, `${commentId}/replies`, { method: 'POST', params: { message: text } }),
  /** Publish an image Story (two steps: create the container, then publish it). */
  publishStory: async (cfg: IgConfig, imageUrl: string) => {
    const c = await graph<{ id: string }>(cfg, `${cfg.userId}/media`, { method: 'POST', params: { image_url: imageUrl, media_type: 'STORIES' } });
    // Give Instagram a moment to fetch the image before publishing.
    for (let i = 0; i < 10; i++) {
      const st = await graph<{ status_code?: string }>(cfg, c.id, { params: { fields: 'status_code' } }).catch(() => ({ status_code: 'IN_PROGRESS' }));
      if (st.status_code === 'FINISHED') break;
      if (st.status_code === 'ERROR') throw new Error('Instagram could not process the Story image.');
      await new Promise((r) => setTimeout(r, 2000));
    }
    return graph<{ id: string }>(cfg, `${cfg.userId}/media_publish`, { method: 'POST', params: { creation_id: c.id } });
  },
};
