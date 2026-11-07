// deno test --allow-env _shared/square.test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { paymentLinkRequest, squareBaseUrl, squareSignature, verifySquareSignature, webhookAction } from './square.ts';

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
  assertEquals(webhookAction(ev('COMPLETED')), { kind: 'fulfil', orderId: 'ord1', squarePaymentId: 'sq1', amountCents: 3500, currency: 'EUR' });
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
