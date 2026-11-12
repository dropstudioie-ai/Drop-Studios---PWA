// Admins change a member's sign-in email. Updates the auth account (so the member
// logs in with the new address straight away) and the profile, and audits it.
import { adminClient, corsHeaders, json, userClient } from '../_shared/http.ts';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const body = await req.json().catch(() => null) as { user_id?: string; email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (typeof body?.user_id !== 'string' || !email || !EMAIL.test(email)) return json(req, { error: 'invalid_email' }, 400);

  const supa = userClient(req);
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return json(req, { error: 'not_authenticated' }, 401);
  const { data: isAdmin } = await supa.rpc('is_admin');
  if (!isAdmin) return json(req, { error: 'forbidden' }, 403);

  const db = adminClient();
  const { data: taken } = await db.from('profiles').select('id').eq('email', email).neq('id', body.user_id).maybeSingle();
  if (taken) return json(req, { error: 'email_in_use' }, 409);

  const { error } = await db.auth.admin.updateUserById(body.user_id, { email, email_confirm: true });
  if (error) {
    console.error('email change failed', error.message);
    return json(req, { error: /already|registered|exists/i.test(error.message) ? 'email_in_use' : 'email_change_failed' }, 400);
  }
  const { error: recErr } = await db.rpc('admin_record_member_email', { p_user_id: body.user_id, p_email: email, p_actor: auth.user.id });
  if (recErr) console.error('profile email update failed', recErr.message);
  return json(req, { ok: true, email });
});
