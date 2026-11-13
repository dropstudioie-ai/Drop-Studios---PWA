import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { canAutoSend, draftReply, HANDOFF, PERSONA } from './brain.ts';
import { parseWebhook, verifySignature } from './instagram.ts';

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
  assertEquals(await draftReply({ client: fakeClient('not json') }, { history: [{ from: 'member', text: 'x' }], knowledge: {}, disclose: false }), HANDOFF);
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
