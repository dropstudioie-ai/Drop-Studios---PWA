// Run on a schedule (with send-notifications; see docs/DEPLOYMENT.md).
// Requires the x-cron-secret header. Restarts the Square subscription of
// paused monthly memberships on their new payment date.
import { restartDueSubscriptions, squareConfig } from '../_shared/squareApi.ts';
import { adminClient } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return new Response('forbidden', { status: 403 });
  const cfg = squareConfig();
  if (!cfg) return Response.json({ skipped: 'square not configured' });
  return Response.json(await restartDueSubscriptions(adminClient(), cfg));
});
