// Run on a schedule (with send-notifications; see docs/DEPLOYMENT.md).
// Requires the x-cron-secret header. Restarts the Square subscription of
// paused monthly memberships on their new payment date, and records Square's
// fee on ticket payments whose webhook didn't include it (for workshop splits).
import { backfillPaymentFees, restartDueSubscriptions, squareConfig } from '../_shared/squareApi.ts';
import { adminClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });
  const cfg = squareConfig();
  if (!cfg) return Response.json({ skipped: 'square not configured' });
  const db = adminClient();
  const restarts = await restartDueSubscriptions(db, cfg);
  const fees = await backfillPaymentFees(db, cfg).catch((e) => { console.error('fee backfill failed', e); return { fees_recorded: 0 }; });
  return Response.json({ ...restarts, ...fees });
});
