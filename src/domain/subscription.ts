// Monthly memberships: 3 monthly payments, then they stop. The database is
// authoritative; these helpers only shape what members see.

export interface Subscription {
  id: string;
  status: 'active' | 'past_due' | 'cancel_scheduled' | 'ended';
  end_reason: 'completed' | 'cancelled' | 'upgraded' | 'provider' | null;
  periods_paid: number;
  total_periods: number;
  next_billing_on: string | null;      // YYYY-MM-DD (Dublin), null when no more payments
  current_period_ends_on: string | null;
  cancel_effective_on: string | null;
  provider_cancel_sent_at: string | null;
  plan_snapshot: { plan_name: string; price_cents: number; currency: string; class_count: number; commitment_months: number | null; credit_rollover: boolean };
  created_at: string;
}

export const CANCEL_NOTICE_HOURS = 72;

/** The date the membership ends (after its last paid month), if known. */
export const endsOn = (s: Pick<Subscription, 'cancel_effective_on' | 'next_billing_on' | 'current_period_ends_on' | 'periods_paid' | 'total_periods'>) =>
  s.cancel_effective_on ?? (s.next_billing_on ? null : s.current_period_ends_on);

/** Midnight (Dublin) starting a date, as a timestamp. Good enough for a notice check shown to members. */
function startOfDay(day: string): number {
  const probe = new Date(`${day}T00:00:00Z`);
  const offset = new Date(probe.toLocaleString('en-US', { timeZone: 'Europe/Dublin' })).getTime() - new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return probe.getTime() - offset;
}

/** What cancelling now would mean (the server decides; this explains it). */
export function cancelPreview(s: Pick<Subscription, 'next_billing_on' | 'current_period_ends_on'>, now = new Date()) {
  if (!s.next_billing_on) return { paymentsLeft: 0, endsOn: s.current_period_ends_on };
  const inTime = now.getTime() <= startOfDay(s.next_billing_on) - CANCEL_NOTICE_HOURS * 3_600_000;
  if (inTime) return { paymentsLeft: 0, endsOn: s.next_billing_on };
  const d = new Date(`${s.next_billing_on}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  return { paymentsLeft: 1, endsOn: d.toISOString().slice(0, 10) };
}

export const isLive = (s: Pick<Subscription, 'status'>) => s.status !== 'ended';

export type OutOfClasses =
  | { kind: 'subscription'; sub: Subscription; nextBilling: string | null; pastDue: boolean }
  | { kind: 'renew' };

/**
 * When a member opens the app with no classes left: monthly members are told
 * when the next classes arrive and offered an upgrade; everyone else is asked
 * to renew or upgrade. Null when they still have classes, or never bought.
 */
export function outOfClasses(
  memberships: { state: string; classes_remaining: number; admin_status: string }[],
  subscriptions: Subscription[],
): OutOfClasses | null {
  if (memberships.length === 0) return null;
  const usable = memberships.some((m) => m.admin_status === 'valid' && m.classes_remaining > 0
    && ['active', 'pending_activation', 'paused'].includes(m.state));
  if (usable) return null;
  const sub = subscriptions.find((s) => isLive(s));
  if (sub) return { kind: 'subscription', sub, nextBilling: sub.next_billing_on, pastDue: sub.status === 'past_due' };
  return { kind: 'renew' };
}
