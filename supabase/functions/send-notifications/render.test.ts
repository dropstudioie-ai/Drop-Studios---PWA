// deno test send-notifications/render.test.ts
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

Deno.env.set('SITE_URL', 'https://app.example.ie');
const { render } = await import('./render.ts');

Deno.test('expiry reminder names the last valid day and classes left', () => {
  const m = render({ kind: 'membership_expiring', full_name: 'Niamh Byrne', payload: { plan_name: '5-Class Multi-Style', expires_at: '2026-11-21T00:00:00Z', classes_remaining: 2 } })!;
  assertEquals(m.subject, 'Your 5-Class Multi-Style expires soon');
  assertStringIncludes(m.text, 'Hi Niamh,');
  assertStringIncludes(m.text, 'Friday, 20 November');
  assertStringIncludes(m.text, '2 classes left');
  assertStringIncludes(m.text, 'https://app.example.ie/timetable');
});

Deno.test('class cancellation explains what happens to the class or ticket', () => {
  const base = { title: 'Heels', starts_at: '2026-11-03T19:00:00Z', reason: 'Instructor ill' };
  assertStringIncludes(render({ kind: 'class_cancelled', full_name: null, payload: { ...base, class_returned: true } })!.text, 'returned to your membership');
  assertStringIncludes(render({ kind: 'class_cancelled', full_name: null, payload: { ...base, ticket_refund: true } })!.text, 'refund your ticket');
  assertEquals(render({ kind: 'nope', full_name: null, payload: {} }), null);
});
