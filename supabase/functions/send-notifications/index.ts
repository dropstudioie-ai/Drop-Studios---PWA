// Delivers queued notifications (notification_outbox) by email and/or web push.
// Run on a schedule (see docs/DEPLOYMENT.md). Requires the x-cron-secret header.
//
// Channels are optional and independent:
//   Email: RESEND_API_KEY + EMAIL_FROM
//   Push:  VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT
import webpush from 'npm:web-push@3.6.7';
import { adminClient } from '../_shared/http.ts';
import { type Claimed, render } from './render.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });

  const resendKey = Deno.env.get('RESEND_API_KEY');
  const emailFrom = Deno.env.get('EMAIL_FROM');
  const emailOn = Boolean(resendKey && emailFrom);
  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY');
  const pushOn = Boolean(vapidPublic && vapidPrivate);
  if (!emailOn && !pushOn) {
    return Response.json({ skipped: 'no channels configured' });
  }
  if (pushOn) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', vapidPublic!, vapidPrivate!);

  const db = adminClient();
  const { data, error } = await db.rpc('claim_notifications', { p_limit: 50 });
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const n of (data ?? []) as Claimed[]) {
    const msg = render(n);
    if (!msg) {
      await db.rpc('complete_notification', { p_id: n.id, p_error: `unknown kind ${n.kind}` });
      failed++;
      continue;
    }

    const errors: string[] = [];
    let delivered = false;

    if (emailOn && n.email) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `outbox-${n.id}` },
        body: JSON.stringify({
          from: emailFrom, to: n.email, subject: msg.subject, text: msg.text,
          // Replies go to the studio's inbox (the sending domain doesn't receive mail).
          ...(Deno.env.get('SUPPORT_EMAIL') ? { reply_to: Deno.env.get('SUPPORT_EMAIL') } : {}),
        }),
      });
      if (res.ok) delivered = true;
      else errors.push(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    if (pushOn) {
      const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({ title: msg.subject, body: msg.text.split('\n\n')[1] ?? msg.subject, url: msg.url }),
          );
          delivered = true;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', sub.id);
          else errors.push(`push ${status ?? ''}: ${(e as Error).message}`.slice(0, 200));
        }
      }
    }

    // Nothing to deliver to (no email address and no push subscription) counts as done.
    const nothingToTry = errors.length === 0 && !delivered;
    await db.rpc('complete_notification', { p_id: n.id, p_error: delivered || nothingToTry ? null : errors.join('; ') });
    if (delivered || nothingToTry) sent++;
    else failed++;
  }

  return Response.json({ sent, failed });
});
