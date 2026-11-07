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

Deno.test('teacher birthday alerts: day before and 10 minutes before', () => {
  const base = { member_name: 'Aoife Byrne', title: 'Heels', starts_at: '2026-11-09T20:00:00Z', turning: 30 };
  const before = render({ kind: 'member_birthday', full_name: 'Talita Lima', payload: { ...base, phase: 'day_before' } })!;
  assertEquals(before.subject, "🎂 Aoife's birthday is at your Heels class");
  assertStringIncludes(before.text, 'Hi Talita,');
  assertStringIncludes(before.text, 'Aoife Byrne (turning 30)');
  assertStringIncludes(before.text, 'Heels class on Monday, 9 November at 20:00, and it\'s their birthday that day');
  const soon = render({ kind: 'member_birthday', full_name: 'Talita Lima', payload: { ...base, phase: 'ten_min' } })!;
  assertEquals(soon.subject, "🎂 Aoife's birthday: Heels starts in 10 minutes");
  assertStringIncludes(soon.text, 'class at 20:00');
  assertEquals(soon.url, '/teach');
});

Deno.test('admin alerts for instructor birthdays: a week before and on the day', () => {
  const base = { instructor_name: 'Vini Martins', birthday: '2026-11-16', turning: 31 };
  const week = render({ kind: 'instructor_birthday', full_name: 'Jorge dos Santos', payload: { ...base, phase: 'week_before' } })!;
  assertEquals(week.subject, "🎂 Vini Martins's birthday is in a week");
  assertStringIncludes(week.text, 'Hi Jorge,');
  assertStringIncludes(week.text, 'next Monday, 16 November (turning 31)');
  const today = render({ kind: 'instructor_birthday', full_name: 'Jorge dos Santos', payload: { ...base, phase: 'on_day' } })!;
  assertEquals(today.subject, "🎂 It's Vini Martins's birthday today");
  assertEquals(today.url, '/admin/instructors');
});
