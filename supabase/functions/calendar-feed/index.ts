// Private calendar feeds for the owner's phone/computer (iCal subscription):
//   ?token=…&type=classes  → Drop classes (orange)
//   ?token=…&type=rentals  → studio rentals (blue)
//   ?token=…&type=all      → both in one calendar
// The token is the secret in rental_private.calendar_token (admin page shows the links).
import { adminClient } from '../_shared/http.ts';
import { icsCalendar, type CalEvent } from './ics.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const type = (['classes', 'rentals', 'all'].includes(url.searchParams.get('type') ?? '') ? url.searchParams.get('type') : 'all') as 'classes' | 'rentals' | 'all';
  const db = adminClient();
  const { data: priv } = await db.from('rental_private').select('calendar_token').limit(1).maybeSingle();
  if (!token || !priv || token !== priv.calendar_token) return new Response('not found', { status: 404 });
  const from = new Date(Date.now() - 30 * 864e5).toISOString(), to = new Date(Date.now() + 120 * 864e5).toISOString();
  const { data, error } = await db.rpc('_calendar_events', { p_from: from, p_to: to, p_type: type });
  if (error) return new Response('error', { status: 500 });
  const name = type === 'classes' ? 'Drop classes' : type === 'rentals' ? 'Drop studio rentals' : 'Drop Studios';
  return new Response(icsCalendar(name, type === 'rentals' ? 'blue' : 'orange', (data ?? []) as CalEvent[]), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Disposition': `inline; filename="${type}.ics"` },
  });
});
