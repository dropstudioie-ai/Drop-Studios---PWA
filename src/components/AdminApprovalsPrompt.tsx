import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { unwrap } from '../api';
import { formatKey } from '../domain/time';

interface Approvals {
  workshops: number; time_off: number; rentals: number; rental_blocks: number; rental_blocks_by: string | null;
  dm_drafts: number; comment_drafts: number; questions: number; payments_to_review: number; refunds: number; refund_requests?: number;
}
const SEEN = 'drop.approvals.seen';
const QUIET = ['/checkin', '/checkout'];

/** When an admin opens the app and something is waiting for their decision, list it (once per visit). */
export function AdminApprovalsPrompt() {
  const { session, isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [a, setA] = useState<Approvals | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session || !isAdmin) return;
    try { if (sessionStorage.getItem(SEEN) === '1') return; } catch { /* storage unavailable */ }
    let live = true;
    supabase.rpc('admin_approvals').then((r) => {
      if (!live) return;
      try { setA(unwrap(r) as Approvals); setOpen(true); } catch { /* not available */ }
    });
    return () => { live = false; };
  }, [session, isAdmin]);

  const close = () => { setOpen(false); try { sessionStorage.setItem(SEEN, '1'); } catch { /* storage unavailable */ } };
  if (!open || !a || QUIET.some((p) => pathname.startsWith(p))) return null;

  const by = a.rental_blocks_by ? ` (by ${formatKey(a.rental_blocks_by, { weekday: 'short', day: 'numeric', month: 'short' })})` : '';
  const items = [
    { n: a.rentals, emoji: '🏠', one: 'studio rental request to approve', many: 'studio rental requests to approve', to: '/admin/rentals' },
    { n: a.rental_blocks, emoji: '📆', one: `regular hire to confirm${by}`, many: `regular hires to confirm${by}`, to: '/admin/rentals' },
    { n: a.workshops, emoji: '✨', one: 'workshop request to approve', many: 'workshop requests to approve', to: '/admin/events' },
    { n: a.time_off, emoji: '🌴', one: 'instructor holiday request', many: 'instructor holiday requests', to: '/admin/timetable' },
    { n: a.dm_drafts, emoji: '💬', one: 'Instagram message reply to approve', many: 'Instagram message replies to approve', to: '/admin/thamires' },
    { n: a.comment_drafts, emoji: '💭', one: 'Instagram comment reply to approve', many: 'Instagram comment replies to approve', to: '/admin/thamires' },
    { n: a.questions, emoji: '❓', one: 'question for you from Thamires', many: 'questions for you from Thamires', to: '/admin/thamires' },
    { n: a.payments_to_review, emoji: '💳', one: 'payment to review', many: 'payments to review', to: '/admin/customers' },
    { n: a.refund_requests ?? 0, emoji: '💶', one: 'Drop In refund request to approve', many: 'Drop In refund requests to approve', to: '/admin' },
    { n: a.refunds, emoji: '↩️', one: 'refund to send', many: 'refunds to send', to: '/admin' },
  ].filter((i) => i.n > 0);
  if (!items.length) return null;
  const total = items.reduce((s, i) => s + i.n, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/70 p-3 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="ap-h">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <p className="text-4xl">🔔</p>
        <h2 id="ap-h" className="mt-2 text-2xl font-black">{total === 1 ? '1 thing is' : `${total} things are`} waiting for you</h2>
        <ul className="mt-4 space-y-2">
          {items.map((i) => (
            <li key={i.one}>
              <Link to={i.to} onClick={close} className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 font-semibold transition hover:border-brand-400 hover:bg-brand-50">
                <span className="text-2xl" aria-hidden="true">{i.emoji}</span>
                <span className="flex-1"><span className="font-display text-lg font-black">{i.n}</span> {i.n === 1 ? i.one : i.many}</span>
                <span aria-hidden="true" className="text-brand-700">→</span>
              </Link>
            </li>
          ))}
        </ul>
        <button className="btn-outline mt-5 w-full" onClick={close}>Later</button>
      </div>
    </div>
  );
}
