// Square webhook: the ONLY place a real payment activates a membership or
// confirms a workshop ticket. Deploy with --no-verify-jwt; authenticity comes
// from Square's signature. Square sends events for every payment on the
// account (including card-reader sales in the studio), so anything that isn't
// an app checkout is acknowledged and ignored.
import { adminClient } from '../_shared/http.ts';
import { verifySquareSignature, webhookAction } from '../_shared/square.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const signatureKey = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? '';
  // Must be exactly the notification URL registered in the Square Developer Console.
  const notificationUrl = Deno.env.get('SQUARE_WEBHOOK_URL') ?? '';
  const rawBody = await req.text();
  const ok = await verifySquareSignature(signatureKey, notificationUrl, rawBody, req.headers.get('x-square-hmacsha256-signature'));
  if (!ok) {
    console.error('Square signature verification failed');
    return new Response('invalid signature', { status: 401 });
  }

  let event: { event_id?: string; type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('invalid body', { status: 400 });
  }

  const action = webhookAction(event as Parameters<typeof webhookAction>[0]);
  const db = adminClient();

  if (action.kind === 'fulfil') {
    const { data: payment } = await db
      .from('payments')
      .select('id')
      .eq('provider', 'square')
      .eq('provider_session_id', action.orderId)
      .maybeSingle();
    if (!payment) return Response.json({ ignored: 'not an app checkout' });

    const { data, error } = await db.rpc('fulfill_payment', {
      p_payment_id: payment.id,
      p_provider: 'square',
      p_provider_ref: action.squarePaymentId,
      p_provider_event_id: event.event_id ?? null,
      p_amount_cents: action.amountCents,
      p_currency: action.currency,
    });
    if (error) {
      console.error('fulfill_payment failed', error.message);
      return new Response('fulfilment error', { status: 500 }); // Square retries
    }
    if (data && !data.ok) console.error('payment rejected', payment.id, data.error);
    if (data?.refund_required) console.error('ticket paid but no spot available — refund needed', payment.id);
    return Response.json({ received: true });
  }

  if (action.kind === 'refund') {
    const { data: payment } = await db
      .from('payments')
      .select('id, amount_cents')
      .eq('provider', 'square')
      .eq('provider_payment_ref', action.squarePaymentId)
      .maybeSingle();
    if (!payment) return Response.json({ ignored: 'not an app payment' });

    // Partial refunds (e.g. a 14-day cancellation minus classes used) are
    // recorded in the audit log; the payment is marked refunded only when the
    // full amount has been returned. Removing remaining classes is a studio
    // decision made in Admin → Customers.
    const { data: already } = await db
      .from('audit_log')
      .select('id')
      .eq('action', 'payment_refunded')
      .eq('entity_id', payment.id)
      .contains('details', { square_refund: action.refundId })
      .maybeSingle();
    if (!already) {
      await db.from('audit_log').insert({
        action: 'payment_refunded', entity_type: 'payment', entity_id: payment.id,
        details: { square_refund: action.refundId, amount_refunded: action.amountCents, currency: action.currency },
      });
      if (action.amountCents >= payment.amount_cents) {
        await db.from('payments').update({ status: 'refunded' }).eq('id', payment.id).eq('status', 'succeeded');
      }
    }
    return Response.json({ received: true });
  }

  return Response.json({ ignored: action.reason });
});
