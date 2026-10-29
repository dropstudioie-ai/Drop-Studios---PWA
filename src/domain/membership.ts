import { addDaysToKey, daysInclusive, localDateKey, STUDIO_TZ, zonedTime } from './time';

export type MembershipState = 'pending_activation' | 'active' | 'paused' | 'expired' | 'used_up' | 'cancelled';

export interface PauseWindow {
  starts_on: string;
  ends_on: string;
  is_cancelled: boolean;
}

/**
 * Mirrors public.compute_expiry: a pack is valid through the end of the local
 * day (activation date + validity days + paused days). Returns the local
 * midnight that ends that day.
 */
export function computeExpiry(activatedAt: Date, validityDays: number, pauseDays = 0, tz = STUDIO_TZ): Date {
  const lastDay = addDaysToKey(localDateKey(activatedAt, tz), validityDays + pauseDays);
  return zonedTime(addDaysToKey(lastDay, 1), 0, tz);
}

/** The last calendar day on which the membership can be used. */
export function lastValidDay(expiresAt: Date | string, tz = STUDIO_TZ): string {
  return addDaysToKey(localDateKey(new Date(expiresAt), tz), -1);
}

export function totalPauseDays(pauses: PauseWindow[]): number {
  return pauses.filter((p) => !p.is_cancelled).reduce((sum, p) => sum + daysInclusive(p.starts_on, p.ends_on), 0);
}

export function isPausedOn(pauses: PauseWindow[], dayKey: string): boolean {
  return pauses.some((p) => !p.is_cancelled && dayKey >= p.starts_on && dayKey <= p.ends_on);
}

/** Mirrors public.state(memberships). The server value is authoritative. */
export function membershipState(
  m: { admin_status: 'valid' | 'cancelled'; activated_at: string | null; expires_at: string | null; classes_remaining: number },
  pauses: PauseWindow[],
  now = new Date(),
  tz = STUDIO_TZ,
): MembershipState {
  if (m.admin_status === 'cancelled') return 'cancelled';
  if (m.activated_at && m.expires_at && new Date(m.expires_at) <= now) return 'expired';
  if (m.activated_at && isPausedOn(pauses, localDateKey(now, tz))) return 'paused';
  if (m.classes_remaining <= 0) return 'used_up';
  if (!m.activated_at) return 'pending_activation';
  return 'active';
}

export const STATE_LABEL: Record<MembershipState, string> = {
  pending_activation: 'Starts with your first booking',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  used_up: 'All classes used',
  cancelled: 'Cancelled',
};

export const progressLabel = (remaining: number, total: number) =>
  `${remaining} of ${total} ${total === 1 ? 'class' : 'classes'} remaining`;

export function isExpiringSoon(expiresAt: string | null, withinDays: number, now = new Date()): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return ms > 0 && ms <= withinDays * 86_400_000;
}

export interface PauseRules {
  todayKey: string;
  expiresOnKey: string; // local date of expires_at (day after last valid day)
  minDays: number;
  remainingAllowance: number;
}

/** Client-side validation for the pause form; the server re-checks everything. */
export function validatePause(startKey: string, endKey: string, rules: PauseRules): string | null {
  if (!startKey || !endKey) return 'Choose a start and end date.';
  if (endKey < startKey) return 'The end date must be on or after the start date.';
  if (startKey < rules.todayKey) return 'A pause cannot start in the past.';
  if (startKey >= rules.expiresOnKey) return 'The pause must start before your membership expires.';
  const days = daysInclusive(startKey, endKey);
  if (days < rules.minDays) return `A pause must be at least ${rules.minDays} days.`;
  if (days > rules.remainingAllowance) return `You have ${rules.remainingAllowance} pause days left this year.`;
  return null;
}
