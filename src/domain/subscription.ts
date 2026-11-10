// Monthly memberships: dates and the "out of classes" message. The database is
// authoritative; these mirror its rules for display only.

export interface Subscription {
  id: string;
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'ended';
  anchor_date: string;          // YYYY-MM-DD, Dublin
  last_period_index: number;
  cancel_effective_on: string | null;
  provider_cancel_sent_at: string | null;
  plan_snapshot: { plan_name: string; price_cents: number; currency: string; class_count: number; commitment_months: number | null; credit_rollover: boolean };
  created_at: string;
}

/** anchor + n months, a missing day falling on the month's last day (Square's rule). */
export function addMonths(anchor: string, n: number): string {
  const [y, m, d] = anchor.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function subscriptionDates(s: Pick<Subscription, 'anchor_date' | 'last_period_index' | 'plan_snapshot'>) {
  const commit = s.plan_snapshot.commitment_months ?? 3;
  const index = Math.max(s.last_period_index, 0);
  const cycle = Math.floor(index / commit);
  return {
    nextBilling: addMonths(s.anchor_date, index + 1),
    monthInCycle: (index % commit) + 1,
    commit,
    cycleEnds: addMonths(s.anchor_date, (cycle + 1) * commit),
    paymentsLeftInCycle: (cycle + 1) * commit - (index + 1),
  };
}

export const isLive = (s: Pick<Subscription, 'status'>) => s.status !== 'ended';

export type OutOfClasses =
  | { kind: 'subscription'; sub: Subscription; nextBilling: string; pastDue: boolean }
  | { kind: 'renew' };

/**
 * When a member opens the app with no classes left: monthly members are told
 * when the next classes arrive; everyone else is asked to renew or upgrade.
 * Null when they still have classes, or have never bought anything.
 */
export function outOfClasses(
  memberships: { state: string; classes_remaining: number; admin_status: string }[],
  subscriptions: Subscription[],
): OutOfClasses | null {
  if (memberships.length === 0) return null;
  const usable = memberships.some((m) => m.admin_status === 'valid' && m.classes_remaining > 0
    && ['active', 'pending_activation', 'paused'].includes(m.state));
  if (usable) return null;
  const sub = subscriptions.find((s) => s.status !== 'ended' && s.status !== 'cancel_scheduled')
    ?? subscriptions.find((s) => s.status === 'cancel_scheduled' && subscriptionDates(s).nextBilling < (s.cancel_effective_on ?? ''));
  if (sub) return { kind: 'subscription', sub, nextBilling: subscriptionDates(sub).nextBilling, pastDue: sub.status === 'past_due' };
  return { kind: 'renew' };
}
