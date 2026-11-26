// TikTok for Thamires: connect Drop's account (Login Kit) and send videos to its drafts (Content Posting API, video.upload).
// Tokens live only in public.tiktok_connection, which only the server (service role) can read.

export const TT_AUTH = 'https://www.tiktok.com/v2/auth/authorize/';
export const TT_API = 'https://open.tiktokapis.com/v2';
export const TT_SCOPES = 'user.info.basic,video.upload';

export interface TtConfig { clientKey: string; clientSecret: string; redirectUri: string }
export function ttConfig(): TtConfig | null {
  const clientKey = Deno.env.get('TIKTOK_CLIENT_KEY');
  const clientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET');
  const base = Deno.env.get('SUPABASE_URL');
  if (!clientKey || !clientSecret || !base) return null;
  return { clientKey, clientSecret, redirectUri: `${base}/functions/v1/thamires/tiktok/callback` };
}

export function authorizeUrl(cfg: TtConfig, state: string) {
  const u = new URL(TT_AUTH);
  u.searchParams.set('client_key', cfg.clientKey);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', TT_SCOPES);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export interface TtTokens { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; scope: string }

async function tokenRequest(cfg: TtConfig, params: Record<string, string>, fetcher = fetch): Promise<TtTokens> {
  const res = await fetcher(`${TT_API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: cfg.clientKey, client_secret: cfg.clientSecret, ...params }),
  });
  const j = await res.json().catch(() => ({})) as Partial<TtTokens> & { error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(`TikTok login failed: ${j.error_description || j.error || res.status}`);
  return j as TtTokens;
}
export const exchangeCode = (cfg: TtConfig, code: string, fetcher = fetch) =>
  tokenRequest(cfg, { code, grant_type: 'authorization_code', redirect_uri: cfg.redirectUri }, fetcher);
export const refreshTokens = (cfg: TtConfig, refresh: string, fetcher = fetch) =>
  tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refresh }, fetcher);

async function api<T>(token: string, path: string, init: { method?: string; body?: unknown } = {}, fetcher = fetch): Promise<T> {
  const res = await fetcher(`${TT_API}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const j = await res.json().catch(() => ({})) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (j.error?.code && j.error.code !== 'ok')) throw new Error(`TikTok: ${j.error?.message || j.error?.code || res.status}`);
  return j.data as T;
}

export const userInfo = (token: string, fetcher = fetch) =>
  api<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(token, '/user/info/?fields=open_id,display_name,avatar_url', {}, fetcher).then((d) => d.user);

/** Upload one video (≤ 64 MB) to the account's TikTok inbox as a draft, in a single chunk. */
export async function sendToDrafts(token: string, video: Uint8Array, fetcher = fetch) {
  const size = video.byteLength;
  if (size > 64 * 1024 * 1024) throw new Error('TikTok: video is over 64 MB');
  const init = await api<{ publish_id: string; upload_url: string }>(token, '/post/publish/inbox/video/init/', {
    method: 'POST', body: { source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } },
  }, fetcher);
  const put = await fetcher(init.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: new Blob([video as BlobPart], { type: "video/mp4" }),
  });
  if (!put.ok) throw new Error(`TikTok upload failed (${put.status})`);
  return init.publish_id;
}

export const publishStatus = (token: string, publishId: string, fetcher = fetch) =>
  api<{ status: string; fail_reason?: string }>(token, '/post/publish/status/fetch/', { method: 'POST', body: { publish_id: publishId } }, fetcher);
