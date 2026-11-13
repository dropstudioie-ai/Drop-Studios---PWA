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

Deno.test('monthly membership messages: failed payment, next payment, ending and reward', () => {
  const failed = render({ kind: 'subscription_payment_failed', full_name: 'Aoife Byrne', payload: { plan_name: 'Committed', price_cents: 7900 } })!;
  assertEquals(failed.subject, "We couldn't take your Committed payment");
  assertStringIncludes(failed.text, '€79.00');
  const next = render({ kind: 'subscription_renewing', full_name: 'Aoife Byrne', payload: { plan_name: 'All In', price_cents: 9900, class_count: 12, on: '2027-02-10', month: 2, of: 3 } })!;
  assertEquals(next.subject, 'Your next All In payment is on Wednesday, 10 February');
  assertStringIncludes(next.text, 'at least 72 hours before Wednesday, 10 February');
  const ending = render({ kind: 'subscription_ending', full_name: 'Aoife Byrne', payload: { plan_name: 'All In', on: '2027-02-10', reward: true } })!;
  assertStringIncludes(ending.text, '3 free classes');
  const reward = render({ kind: 'loyalty_reward', full_name: 'Aoife Byrne', payload: { classes: 3, days: 7 } })!;
  assertEquals(reward.subject, "Aoife, you've found your rhythm! 💃");
  assertStringIncludes(reward.text, "To celebrate 3 months dancing at Drop, we've added 3 free classes to your account. Book any class you like in the next 7 days. Enjoy!");
  assertEquals(reward.url, '/timetable');
});

Deno.test('test message for checking delivery', () => {
  const m = render({ kind: 'test_message', full_name: 'Jorge dos Santos', payload: {} })!;
  assertEquals(m.subject, 'Drop Studios: notifications are working ✅');
  assertStringIncludes(m.text, 'Hi Jorge,');
});

Deno.test('payment receipt: plan, month, amount, next payment, business name', () => {
  const m = render({ kind: 'payment_receipt', full_name: 'Aoife Byrne', payload: {
    receipt_no: 'AB12CD34EF', plan_name: 'Committed', amount_cents: 7900, currency: 'EUR', paid_at: '2026-11-12T10:00:00Z',
    provider: 'square', classes: 8, month: 1, of: 3, next_billing_on: '2026-12-12' } })!;
  assertEquals(m.subject, 'Your Drop Studios receipt: Committed, €79.00');
  assertStringIncludes(m.text, 'Membership: Committed (payment 1 of 3)');
  assertStringIncludes(m.text, 'Your next payment of €79.00 is on Saturday, 12 December.');
  assertStringIncludes(m.text, 'Drop Studios Limited');
  const intro = render({ kind: 'payment_receipt', full_name: 'Aoife Byrne', payload: {
    receipt_no: 'X', plan_name: '3-Class Intro Offer', amount_cents: 3500, currency: 'EUR', paid_at: '2026-11-12T10:00:00Z', provider: 'manual', classes: 3 } })!;
  assertStringIncludes(intro.text, 'Paid by: at the studio');
  assertEquals(intro.text.includes('next payment'), false);
});

Deno.test('class changed: new time and instructor', () => {
  const m = render({ kind: 'class_changed', full_name: 'Aoife Byrne', payload: {
    title: 'Heels', old_title: 'Heels', starts_at: '2026-11-12T19:00:00Z', old_starts_at: '2026-11-12T18:30:00Z',
    time_changed: true, instructor_changed: true, instructor: 'Vini Martins', old_instructor: 'Talita Lima', note: 'Sorry!' } })!;
  assertEquals(m.subject, 'Change to your class: Heels, Thursday, 12 November at 19:00');
  assertStringIncludes(m.text, 'New time: Thursday, 12 November at 19:00 (was Thursday, 12 November at 18:30)');
  assertStringIncludes(m.text, 'New instructor: Vini Martins (was Talita Lima)');
  assertStringIncludes(m.text, 'Sorry!');
});

Deno.test('event details always say the dress code is optional', () => {
  const payload = { title: 'All Black FitDance', kind: 'special_class', instructor: 'Jorginho', starts_at: '2026-11-27T18:30:00Z', dress_code: 'All black', session_id: 's1', description: 'Our darkest class yet.' };
  for (const kind of ['event_announced', 'event_details', 'event_reminder']) {
    const m = render({ kind, full_name: 'Aoife Byrne', payload })!;
    assertStringIncludes(m.text, 'What to wear: All black');
    assertStringIncludes(m.text, 'encouraged, never required');
    assertEquals(m.url, '/timetable?class=s1');
  }
  const ws = render({ kind: 'event_announced', full_name: null, payload: { ...payload, kind: 'workshop', price_cents: 2500, member_price_cents: 2000, dress_code: null } })!;
  assertStringIncludes(ws.text, '€25.00 (members €20.00)');
  assertEquals(ws.text.includes('What to wear'), false);
});

Deno.test('the monthly prompt lists next month\'s dates', () => {
  const m = render({ kind: 'event_prompt', full_name: 'Talita Lima', payload: { month: '2027-03-01', themes: [
    { name: "St Patrick's Day", emoji: '☘️', on: '2027-03-17', ideas: 'Wear green' }, { name: 'Pride Month', emoji: '🏳️‍🌈', on: null }] } })!;
  assertStringIncludes(m.subject, 'March is coming');
  assertStringIncludes(m.text, "☘️ St Patrick's Day (Wed, 17 Mar)");
  assertStringIncludes(m.text, 'Pride Month (all month)');
  assertEquals(m.url, '/teach/events');
});

Deno.test('moved events tell each group what it means for them', () => {
  const payload = { title: 'Christmas Heels', instructor: 'Talita', starts_at: '2026-12-20T15:00:00Z', old_starts_at: '2026-12-19T15:00:00Z', session_id: 's9', old_class_title: 'Heels' };
  assertStringIncludes(render({ kind: 'event_rescheduled', full_name: null, payload: { ...payload, audience: 'ticket' } })!.text, 'refund your ticket');
  assertStringIncludes(render({ kind: 'event_rescheduled', full_name: null, payload: { ...payload, audience: 'old_class' } })!.text, 'now runs as a normal class');
  assertStringIncludes(render({ kind: 'event_rescheduled', full_name: null, payload: { ...payload, audience: 'told' } })!.subject, 'New date');
  assertStringIncludes(render({ kind: 'event_staff_change', full_name: null, payload: { ...payload, action: 'cancelled', reason: 'Injured', refunds: 3 } })!.text, '3 tickets need a refund');
});

Deno.test('membership cancelled by the studio', () => {
  const m = render({ kind: 'membership_cancelled', full_name: 'Aoife Byrne', payload: { plan_name: '3-Class Intro', reason: 'Moving abroad', bookings_cancelled: 2 } })!;
  assertEquals(m.subject, 'Your 3-Class Intro has been cancelled');
  assertStringIncludes(m.text, '2 upcoming bookings have been cancelled');
});

Deno.test('feedback request links to the feedback page', () => {
  const m = render({ kind: 'feedback_request', full_name: 'Aoife Byrne', payload: { feedback_id: 'f1', title: 'Heels', starts_at: '2026-11-20T19:00:00Z', instructor: 'Talita', reason: 'first_in_style' } })!;
  assertEquals(m.url, '/feedback/f1');
  assertStringIncludes(m.subject, 'How was Heels');
  assertStringIncludes(m.text, 'first class in this style');
  assertStringIncludes(m.text, 'not your name');
});

Deno.test('members get the instructor birthday a week before and on the day', () => {
  const base = { instructor_name: 'Talita', title: 'Heels', starts_at: '2026-11-20T19:00:00Z' };
  const week = render({ kind: 'instructor_birthday_member', full_name: 'Aoife', payload: { ...base, phase: 'week_before', birthday: '2026-11-21' } })!;
  assertStringIncludes(week.subject, 'coming up');
  assertStringIncludes(week.text, '21 November');
  const today = render({ kind: 'instructor_birthday_member', full_name: 'Aoife', payload: { ...base, phase: 'on_day', birthday: '2026-11-20' } })!;
  assertStringIncludes(today.subject, "birthday today");
});
