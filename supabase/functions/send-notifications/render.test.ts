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

Deno.test('admin is asked to review a payment made on a replaced checkout', () => {
  const m = render({ kind: 'payment_review', full_name: 'Jorge dos Santos', payload: { member_name: 'Anna Coutinho', plan_name: '3-Class Intro', amount_cents: 3500, user_id: 'u1' } })!;
  assertEquals(m.subject, 'Payment to review: Anna Coutinho paid an old checkout');
  assertStringIncludes(m.text, '€35.00 for 3-Class Intro');
  assertEquals(m.url, '/admin/customers?user=u1');
});

Deno.test('monthly membership messages: failed payment, renewal and ending', () => {
  const failed = render({ kind: 'subscription_payment_failed', full_name: 'Aoife Byrne', payload: { plan_name: 'Committed', price_cents: 7900 } })!;
  assertEquals(failed.subject, "We couldn't take your Committed payment");
  assertStringIncludes(failed.text, '€79.00');
  const renew = render({ kind: 'subscription_renewing', full_name: 'Aoife Byrne', payload: { plan_name: 'All In', price_cents: 9900, class_count: 12, commitment_months: 3, on: '2027-02-10' } })!;
  assertEquals(renew.subject, 'Your All In renews on Wednesday, 10 February');
  assertStringIncludes(renew.text, 'another 3 months on Wednesday, 10 February: €99.00 a month for 12 classes a month');
  const ending = render({ kind: 'subscription_ending', full_name: 'Aoife Byrne', payload: { plan_name: 'All In', on: '2027-02-10' } })!;
  assertEquals(ending.url, '/memberships');
});
