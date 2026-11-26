import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { canAutoSend, canAutoSendHolding, draftReply, HANDOFF, PERSONA, summariseDay } from './brain.ts';
import { DEFAULT_GRAPH_BASE, igConfig, messagesPath, parseWebhook, verifySignature } from './instagram.ts';

Deno.test('persona: discloses AI, never invents, hands over sensitive topics', () => {
  assertStringIncludes(PERSONA, 'You are an AI assistant, not a person');
  assertStringIncludes(PERSONA, 'Never invent');
  assertStringIncludes(PERSONA, 'refunds');
  assertStringIncludes(PERSONA, 'Never ask for card details');
});

const fakeClient = (reply: unknown, stop = 'end_turn') => ({
  beta: { messages: { create: async (req: Record<string, unknown>) => { lastReq = req; return { stop_reason: stop, content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] }; } } },
}) as never;
let lastReq: Record<string, unknown> = {};

Deno.test('drafts a reply with live knowledge and the disclosure note', async () => {
  const d = await draftReply({ client: fakeClient({ reply: 'Hi! I’m Thamires…', needs_human: false, reason: 'timetable', topic: 'timetable' }) },
    { history: [{ from: 'member', text: 'When is heels?' }], knowledge: { plans: [1] }, disclose: true });
  assertEquals(d.topic, 'timetable');
  assertEquals(lastReq.model, 'claude-opus-5-5');
  const sys = JSON.stringify(lastReq.system);
  assertStringIncludes(sys, 'Studio knowledge');
  assertStringIncludes(sys, 'introduce yourself as Thamires');
  assert(canAutoSend(d));
});

Deno.test('refusals, bad JSON and sensitive topics go to a person', async () => {
  assertEquals(await draftReply({ client: fakeClient('', 'refusal') }, { history: [{ from: 'member', text: 'x' }], knowledge: {}, disclose: false }), HANDOFF);
  const bad = await draftReply({ client: fakeClient('not json') }, { history: [{ from: 'member', text: 'x' }], knowledge: {}, disclose: false });
  assertEquals({ ...bad, reason: '' }, { ...HANDOFF, reason: '' });
  assertStringIncludes(bad.reason, 'could not reach her AI brain'); // the team sees why
  const leaky = await draftReply({ client: { beta: { messages: { create: () => { throw new Error('401 invalid x-api-key sk-ant-api03-abc_DEF'); } } } } } as never, { history: [{ from: 'member', text: 'x' }], knowledge: {}, disclose: false });
  assert(!leaky.reason.includes('sk-ant-api03'));
  assert(!canAutoSend({ ...HANDOFF, needs_human: false, topic: 'refund_or_payment' }));
  assert(!canAutoSend({ ...HANDOFF, needs_human: true, topic: 'prices' }));
});

Deno.test('webhook signature check', async () => {
  const raw = '{"object":"instagram"}';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const hex = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  assert(await verifySignature(raw, `sha256=${hex}`, 's3cret'));
  assert(!(await verifySignature(raw, `sha256=${hex}`, 'wrong')));
  assert(!(await verifySignature(raw, null, 's3cret')));
});

Deno.test('parses DMs, story mentions, story replies and post mentions; ignores echoes', () => {
  const ev = parseWebhook({ object: 'instagram', entry: [{ id: 'ME', messaging: [
    { sender: { id: 'u1' }, message: { mid: 'm1', text: 'Hi!' } },
    { sender: { id: 'u2' }, message: { mid: 'm2', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn/x' } }] } },
    { sender: { id: 'u3' }, message: { mid: 'm3', text: 'love it', reply_to: { story: { id: 's' } } } },
    { sender: { id: 'ME' }, message: { mid: 'm4', text: 'our reply', is_echo: true } },
  ], changes: [{ field: 'mentions', value: { media_id: 'post1' } }] }] }, 'ME');
  assertEquals(ev.map((e) => e.type), ['message', 'story_mention', 'story_reply', 'post_mention']);
});

Deno.test('talks in the person’s native language and tells the team what it says', async () => {
  assertStringIncludes(PERSONA, 'native language');
  assertStringIncludes(PERSONA, 'Prefere falar em português?');
  assertStringIncludes(PERSONA, 'offer once');
  await draftReply({ client: fakeClient({ reply: 'Olá! Sou a Thamires…', needs_human: false, reason: 'x', topic: 'timetable', language: 'Portuguese (Brazil)', offered_language: false, translation_en: 'Them: When is heels? / Reply: Hi! I’m Thamires…' }) },
    { history: [{ from: 'member', text: 'Quando é a aula de heels?' }], knowledge: {}, disclose: true, person: { name: 'João Silva', username: 'joaos' }, language: 'Portuguese (Brazil)', languageOffered: true });
  const sys = JSON.stringify(lastReq.system);
  assertStringIncludes(sys, 'João Silva @joaos');
  assertStringIncludes(sys, 'preferred language in this conversation: Portuguese (Brazil)');
  assertStringIncludes(sys, 'already offered to switch language');
  const schema = JSON.stringify(lastReq.output_config);
  assertStringIncludes(schema, 'translation_en');
});

Deno.test('easy-going and funny, remembers people and follows up', async () => {
  assertStringIncludes(PERSONA, 'Easy-going, funny and always polite');
  assertStringIncludes(PERSONA, 'small talk');
  assertStringIncludes(PERSONA, 'Read the room');
  const d = await draftReply({ client: fakeClient({ reply: 'Welcome back! How did heels go? 😄', needs_human: false, reason: 'x', topic: 'class_info', language: 'English', offered_language: false, translation_en: '', memory: 'Aoife. Took her first heels class.' }) },
    { history: [{ from: 'member', text: 'Hi again!' }], knowledge: {}, disclose: false, memory: 'Aoife. First heels class planned for Monday.', daysSinceLastChat: 5 });
  const sys = JSON.stringify(lastReq.system);
  assertStringIncludes(sys, 'First heels class planned for Monday');
  assertStringIncludes(sys, 'coming back after 5 days');
  assertEquals(d.memory, 'Aoife. Took her first heels class.');
  assertStringIncludes(JSON.stringify(lastReq.output_config), 'Never store health');
});

Deno.test('Facebook Login setup: graph.facebook.com, DMs sent through the Page', () => {
  Deno.env.set('IG_USER_ID', '178'); Deno.env.set('IG_ACCESS_TOKEN', 't'); Deno.env.set('IG_PAGE_ID', '555'); Deno.env.delete('IG_GRAPH_BASE');
  const cfg = igConfig()!;
  assertEquals(cfg.base, DEFAULT_GRAPH_BASE);
  assertEquals(messagesPath(cfg), '555/messages');
  Deno.env.delete('IG_PAGE_ID');
  assertEquals(messagesPath(igConfig()!), '178/messages');
});

Deno.test('out-of-the-ordinary questions always wait for the owner', async () => {
  assertStringIncludes(PERSONA, 'never guess');
  assertStringIncludes(PERSONA, 'owner_guidance');
  const d = await draftReply({ client: fakeClient({ reply: 'Great question! Let me check with the team 😊', needs_human: false, reason: 'unusual', topic: 'other', language: 'English', offered_language: false, translation_en: '', memory: '', out_of_ordinary: true, question_en: 'Can I bring my dog to class?' }) },
    { history: [{ from: 'member', text: 'Can I bring my dog?' }], knowledge: {}, disclose: false });
  assertEquals(d.needs_human, true); // forced, even if the model forgot
  assertEquals(d.question_en, 'Can I bring my dog to class?');
  assertEquals(canAutoSend(d), false);
  assertEquals(canAutoSendHolding(d), true);
  assertEquals(canAutoSendHolding({ ...d, topic: 'complaint' }), false);
  // Once the owner has answered, she follows up with the answer.
  await draftReply({ client: fakeClient({ ...HANDOFF, reply: 'Good news!' }) }, { history: [{ from: 'member', text: 'Can I bring my dog?' }], knowledge: {}, disclose: false, followUp: true });
  assertStringIncludes(JSON.stringify(lastReq.system), 'The owner has now answered');
});

Deno.test('daily summary: English, no names, null when there were no messages', async () => {
  assertEquals(await summariseDay({ client: fakeClient({}) }, []), null);
  const s = await summariseDay({ client: fakeClient({ summary: 'Busy day for heels.', themes: [{ theme: 'Heels', count: 3 }], suggestions: [] }) }, ['Is there heels today?', 'Tem aula de heels?']);
  assertEquals(s?.themes[0].theme, 'Heels');
  assertStringIncludes(JSON.stringify(lastReq.system), 'Never include names');
  assertEquals(await summariseDay({ client: fakeClient('not json') }, ['x']), null);
});

Deno.test('webhooks: comments, reactions and Story insights (own comments ignored)', () => {
  const evs = parseWebhook({ object: 'instagram', entry: [{ id: 'DROP', time: 1,
    messaging: [{ sender: { id: 'u1' }, recipient: { id: 'DROP' }, reaction: { mid: 'm9', action: 'react', reaction: 'love', emoji: '❤️' } },
                { sender: { id: 'u1' }, recipient: { id: 'DROP' }, reaction: { mid: 'm9', action: 'unreact' } }],
    changes: [
      { field: 'comments', value: { id: 'c1', text: 'What time is heels?', from: { id: 'u2', username: 'ana' }, media: { id: 'p1' } } },
      { field: 'comments', value: { id: 'c2', text: 'Thanks! – Thamires 🤖', from: { id: 'DROP', username: 'atdropstudios' }, media: { id: 'p1' } } },
      { field: 'story_insights', value: { media_id: 's1', reach: 120, replies: 3, exits: 4 } },
    ] }] } as never, 'DROP');
  assertEquals(evs, [
    { type: 'reaction', from: 'u1', mid: 'm9', emoji: '❤️' },
    { type: 'reaction', from: 'u1', mid: 'm9', emoji: null },
    { type: 'comment', commentId: 'c1', mediaId: 'p1', parentId: null, from: 'u2', username: 'ana', text: 'What time is heels?' },
    { type: 'story_insights', mediaId: 's1', metrics: { reach: 120, replies: 3, exits: 4 } },
  ]);
});

Deno.test('comment replies are public, short and signed', async () => {
  assertStringIncludes(PERSONA, 'Your reply is public');
  assertStringIncludes(PERSONA, '– Thamires 🤖');
  await draftReply({ client: fakeClient({ ...HANDOFF, reply: 'Thank you! 💃 – Thamires 🤖', needs_human: false }) }, { history: [{ from: 'member', text: 'Love this!' }], knowledge: {}, disclose: false, task: 'comment' });
  assertStringIncludes(JSON.stringify(lastReq.system), 'public comment');
});

Deno.test('promo spacing: siblings never post within 23h of each other', async () => {
  const { blockedBySibling } = await import('./brain.ts');
  const now = new Date('2026-11-27T12:01:00Z');
  const a = { id: 'a', spacing_group: 'rental', last_posted_at: '2026-11-26T12:01:30Z', progress: null };
  const b = { id: 'b', spacing_group: 'rental', last_posted_at: '2026-11-25T12:01:00Z', progress: null };
  const other = { id: 'c', spacing_group: null, last_posted_at: '2026-11-27T12:00:00Z', progress: null };
  assertEquals(blockedBySibling(b, [a, b, other], now, '2026-11-27'), false); // a went up just under 24h ago: hand over
  assertEquals(blockedBySibling(b, [{ ...a, last_posted_at: '2026-11-27T02:00:00Z' }, b], now, '2026-11-27'), true); // a posted late after a missed day
  assertEquals(blockedBySibling(b, [{ ...a, last_posted_at: null, progress: { date: '2026-11-27' } }, b], now, '2026-11-27'), true); // a mid-post
  assertEquals(blockedBySibling(other, [a, b, other], now, '2026-11-27'), false); // no group: never blocked
});

Deno.test('tiktok: login link, token exchange and sending a video to drafts', async () => {
  const { authorizeUrl, exchangeCode, sendToDrafts } = await import('./tiktok.ts');
  const cfg = { clientKey: 'ck', clientSecret: 'cs', redirectUri: 'https://x.supabase.co/functions/v1/thamires/tiktok/callback' };
  const u = new URL(authorizeUrl(cfg, 'st1'));
  assertEquals(u.origin + u.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assertEquals(u.searchParams.get('scope'), 'user.info.basic,video.upload');
  assertEquals(u.searchParams.get('redirect_uri'), cfg.redirectUri);
  assertEquals(u.searchParams.get('state'), 'st1');

  const calls: { url: string; init?: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth/token/')) return Response.json({ access_token: 'at', refresh_token: 'rt', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'oid', scope: 'video.upload' });
    if (String(url).endsWith('/inbox/video/init/')) return Response.json({ data: { publish_id: 'p1', upload_url: 'https://upload.example/u' }, error: { code: 'ok' } });
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  const t = await exchangeCode(cfg, 'code1', fake);
  assertEquals(t.access_token, 'at');
  const form = new URLSearchParams(String(calls[0].init?.body));
  assertEquals([form.get('grant_type'), form.get('code'), form.get('client_key')], ['authorization_code', 'code1', 'ck']);

  const id = await sendToDrafts('at', new Uint8Array(1000), fake);
  assertEquals(id, 'p1');
  const init = JSON.parse(String(calls[1].init?.body));
  assertEquals(init.source_info, { source: 'FILE_UPLOAD', video_size: 1000, chunk_size: 1000, total_chunk_count: 1 });
  assertEquals((calls[2].init?.headers as Record<string, string>)['Content-Range'], 'bytes 0-999/1000');
});
