// Instagram (Meta Graph API) for Thamires: webhook verification and parsing, sending DMs,
// commenting on posts that mention Drop, and publishing Stories.
// Endpoint details are kept in this one file so they can be adjusted to the account's Meta setup.

export interface IgConfig { base: string; userId: string; token: string }

export function igConfig(): IgConfig | null {
  const userId = Deno.env.get('IG_USER_ID'), token = Deno.env.get('IG_ACCESS_TOKEN');
  if (!userId || !token) return null;
  return { base: Deno.env.get('IG_GRAPH_BASE') ?? 'https://graph.instagram.com/v23.0', userId, token };
}

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
  | { type: 'post_mention'; mediaId: string; commentId: string | null };

interface Messaging { sender?: { id?: string }; recipient?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean; is_deleted?: boolean; reply_to?: { story?: unknown }; attachments?: { type?: string; payload?: { url?: string } }[] } }
interface WebhookBody { object?: string; entry?: { id?: string; messaging?: Messaging[]; changes?: { field?: string; value?: { media_id?: string; comment_id?: string } }[] }[] }

/** Turn a webhook payload into the events Thamires handles. Echoes of our own messages are ignored. */
export function parseWebhook(body: WebhookBody, ownId?: string): IgEvent[] {
  const out: IgEvent[] = [];
  if (body?.object !== 'instagram') return out;
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message, from = m.sender?.id;
      if (!msg?.mid || !from || msg.is_echo || msg.is_deleted || from === ownId || from === entry.id) continue;
      const mention = msg.attachments?.find((a) => a.type === 'story_mention');
      if (mention) out.push({ type: 'story_mention', from, mid: msg.mid, url: mention.payload?.url ?? null });
      else if (msg.reply_to?.story && msg.text) out.push({ type: 'story_reply', from, mid: msg.mid, text: msg.text });
      else if (msg.text) out.push({ type: 'message', from, mid: msg.mid, text: msg.text });
    }
    for (const c of entry.changes ?? []) {
      if (c.field === 'mentions' && c.value?.media_id) out.push({ type: 'post_mention', mediaId: c.value.media_id, commentId: c.value.comment_id ?? null });
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
    graph<{ message_id?: string }>(cfg, `${cfg.userId}/messages`, { method: 'POST', body: { recipient: { id: to }, message: { text } } }),
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
