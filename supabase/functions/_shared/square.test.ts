// deno test --allow-env _shared/square.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { orderWasPaid, restartSubscriptionRequest, paymentLinkRequest, refundRequest, subscriptionEvent, subscriptionLinkRequest, subscriptionPlanUpsert, squareBaseUrl, squareSignature, verifySquareSignature, webhookAction } from './square.ts';

Deno.test('signature matches the HMAC-SHA256(url + body) scheme used by Square', async () => {
  const body = '{"merchant_id":"M1","type":"payment.updated","event_id":"e1"}';
  const url = 'https://ref.supabase.co/functions/v1/square-webhook';
  // Reference computed independently:
  // printf '%s' "$url$body" | openssl dgst -sha256 -hmac test-signature-key -binary | base64
  const sig = await squareSignature('test-signature-key', url, body);
  assertEquals(sig, 'xzEt2Yon21a5wYDaWezXS5cfTrR9iDAbPdGWJD2n8Ic=');
  assert(await verifySquareSignature('test-signature-key', url, body, sig));
  assert(!(await verifySquareSignature('test-signature-key', url, body + ' ', sig)), 'tampered body');
  assert(!(await verifySquareSignature('test-signature-key', url + '/x', body, sig)), 'different URL');
  assert(!(await verifySquareSignature('other-key', url, body, sig)), 'wrong key');
  assert(!(await verifySquareSignature('test-signature-key', url, body, null)), 'missing header');
});

Deno.test('payment link: database price, no tipping, our payment id as reference', () => {
  const req = paymentLinkRequest(
    { payment_id: 'pay-123', amount_cents: 5500, currency: 'eur', plan_name: '5-Class Multi-Style', class_count: 5 },
    { locationId: 'LOC1', siteUrl: 'https://www.dropstudios.ie', buyerEmail: 'a@b.ie', kind: 'membership' },
  );
  assertEquals(req.idempotency_key, 'drop-link-pay-123');
  assertEquals(req.order.location_id, 'LOC1');
  assertEquals(req.order.reference_id, 'pay-123');
  assertEquals(req.order.line_items[0].base_price_money, { amount: 5500, currency: 'EUR' });
  assertEquals(req.order.line_items[0].quantity, '1');
  assertEquals(req.checkout_options.allow_tipping, false);
  assertEquals(req.checkout_options.redirect_url, 'https://www.dropstudios.ie/checkout/success?payment_id=pay-123');
  assertEquals(req.pre_populated_data, { buyer_email: 'a@b.ie' });
});

Deno.test('payment link labels Drop Ins and tickets', () => {
  const p = { payment_id: 'pay-9', amount_cents: 1500, currency: 'EUR', plan_name: 'Drop In: FitDance', class_count: null };
  const base = { locationId: 'LOC1', siteUrl: 'https://x.ie' };
  assertEquals(paymentLinkRequest(p, { ...base, kind: 'drop_in' }).order.line_items[0].note, 'Drop In: single class');
  assertEquals(paymentLinkRequest(p, { ...base, kind: 'ticket' }).order.line_items[0].note, 'Workshop ticket');
  assertEquals(paymentLinkRequest(p, { ...base, kind: 'drop_in' }).order.line_items[0].name, 'Drop Studios — Drop In: FitDance');
});

Deno.test('only COMPLETED payments activate anything', () => {
  const ev = (status: string) => ({ type: 'payment.updated', data: { object: { payment: { id: 'sq1', order_id: 'ord1', status, amount_money: { amount: 3500, currency: 'EUR' } } } } });
  assertEquals(webhookAction(ev('COMPLETED')), { kind: 'fulfil', orderId: 'ord1', squarePaymentId: 'sq1', amountCents: 3500, currency: 'EUR', customerId: null, feeCents: null });
  for (const s of ['APPROVED', 'PENDING', 'CANCELED', 'FAILED']) assertEquals(webhookAction(ev(s)).kind, 'ignore');
  assertEquals(webhookAction({ type: 'payment.updated', data: { object: { payment: { id: 'pos', status: 'COMPLETED' } } } }).kind, 'ignore');
  assertEquals(webhookAction({ type: 'customer.created' }).kind, 'ignore');
});

Deno.test('completed refunds are recorded', () => {
  const r = webhookAction({ type: 'refund.updated', data: { object: { refund: { id: 'rf1', payment_id: 'sq1', status: 'COMPLETED', amount_money: { amount: 1100, currency: 'EUR' } } } } });
  assertEquals(r, { kind: 'refund', squarePaymentId: 'sq1', refundId: 'rf1', amountCents: 1100, currency: 'EUR' });
  assertEquals(webhookAction({ type: 'refund.created', data: { object: { refund: { id: 'rf2', payment_id: 'sq1', status: 'PENDING' } } } }).kind, 'ignore');
});

Deno.test('sandbox unless production is chosen', () => {
  assertEquals(squareBaseUrl(undefined), 'https://connect.squareupsandbox.com');
  assertEquals(squareBaseUrl('sandbox'), 'https://connect.squareupsandbox.com');
  assertEquals(squareBaseUrl('production'), 'https://connect.squareup.com');
});

Deno.test('an unpaid payment-link order is OPEN with no tenders', () => {
  assertEquals(orderWasPaid({ state: 'OPEN' }), false);
  assertEquals(orderWasPaid({ state: 'OPEN', tenders: [] }), false);
  assertEquals(orderWasPaid({ state: 'OPEN', tenders: [{ id: 't1' }] }), true);
  assertEquals(orderWasPaid({ state: 'COMPLETED' }), true);
  assertEquals(orderWasPaid(null), false);
});

Deno.test('monthly plan: one MONTHLY phase at a static price, 3 payments', () => {
  const body = subscriptionPlanUpsert({ planCode: 'multi-8', planName: 'Committed', priceCents: 7900, currency: 'eur', periods: 3 });
  const variation = body.batches[0].objects[1];
  assertEquals(variation.type, 'SUBSCRIPTION_PLAN_VARIATION');
  assertEquals(variation.subscription_plan_variation_data!.subscription_plan_id, '#plan');
  assertEquals(variation.subscription_plan_variation_data!.phases, [
    { cadence: 'MONTHLY', ordinal: 0, periods: 3, pricing: { type: 'STATIC', price_money: { amount: 7900, currency: 'EUR' } } },
  ]);
  assertEquals(body.idempotency_key, 'drop-plan-multi-8-7900-3');
});

Deno.test('subscription checkout link: quick pay at the plan price with the variation id', () => {
  const body = subscriptionLinkRequest(
    { payment_id: 'pay1', amount_cents: 7900, currency: 'eur', plan_name: 'Committed', class_count: 8 },
    { locationId: 'L1', siteUrl: 'https://x.ie', variationId: 'VAR1', buyerEmail: 'a@b.ie', commitmentMonths: 3 },
  );
  assertEquals(body.quick_pay.price_money, { amount: 7900, currency: 'EUR' });
  assertEquals(body.checkout_options.subscription_plan_id, 'VAR1');
  assertEquals(body.checkout_options.allow_tipping, false);
  assertEquals(body.idempotency_key, 'drop-link-pay1');
});

Deno.test('reads monthly invoice payments, failures and subscription status changes', () => {
  assertEquals(subscriptionEvent({ type: 'invoice.payment_made', data: { object: { invoice: {
    id: 'inv1', subscription_id: 's1', updated_at: '2026-12-10T09:00:00Z',
    payment_requests: [{ total_completed_amount_money: { amount: 7900, currency: 'EUR' } }] } } } }),
    { kind: 'invoice_paid', subscriptionId: 's1', invoiceId: 'inv1', amountCents: 7900, currency: 'EUR', paidAt: '2026-12-10T09:00:00Z' });
  assertEquals(subscriptionEvent({ type: 'invoice.scheduled_charge_failed', data: { object: { invoice: { id: 'inv2', subscription_id: 's1' } } } }),
    { kind: 'invoice_failed', subscriptionId: 's1', invoiceId: 'inv2' });
  assertEquals(subscriptionEvent({ type: 'subscription.updated', data: { object: { subscription: { id: 's1', customer_id: 'C1', plan_variation_id: 'V', status: 'CANCELED' } } } }),
    { kind: 'subscription', subscriptionId: 's1', customerId: 'C1', planVariationId: 'V', status: 'CANCELED' });
  // An invoice that isn't for a subscription (e.g. a manual invoice) is not ours.
  assertEquals(subscriptionEvent({ type: 'invoice.payment_made', data: { object: { invoice: { id: 'inv3' } } } }), { kind: 'none' });
});

Deno.test('pause: restart on the new payment date with the saved card, once per date', () => {
  assertEquals(restartSubscriptionRequest({ subscriptionId: 's1', nextBillingOn: '2026-12-17', locationId: 'L1', variationId: 'V2', customerId: 'C1', cardId: 'ccof:1' }), {
    idempotency_key: 'drop-restart-s1-2026-12-17', location_id: 'L1', plan_variation_id: 'V2', customer_id: 'C1', card_id: 'ccof:1', timezone: 'Europe/Dublin',
  });
});

Deno.test('refund: Square payment id, exact amount, one refund per payment', () => {
  assertEquals(refundRequest({ paymentId: 'p1', squarePaymentId: 'sq1', amountCents: 5500, currency: 'eur', reason: 'Cooling-off' }),
    { idempotency_key: 'drop-refund-p1', payment_id: 'sq1', amount_money: { amount: 5500, currency: 'EUR' }, reason: 'Cooling-off' });
});

Deno.test('the processing fee is read from the payment once Square reports it', () => {
  const base = { type: 'payment.updated', data: { object: { payment: { id: 'p1', order_id: 'o1', status: 'COMPLETED', amount_money: { amount: 3000, currency: 'EUR' } } } } };
  const a = webhookAction(base);
  assertEquals(a.kind === 'fulfil' && a.feeCents, null);
  const b = webhookAction({ ...base, data: { object: { payment: { ...base.data.object.payment,
    processing_fee: [{ amount_money: { amount: 67, currency: 'EUR' } }, { amount_money: { amount: 3, currency: 'EUR' } }] } } } });
  assertEquals(b.kind === 'fulfil' && b.feeCents, 70);
});
