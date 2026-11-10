import { formatPrice } from './money';

export type StyleAccess = 'single' | 'multi';

export interface MembershipPlan {
  id: string;
  code: string;
  name: string;
  display_label: string | null;
  short_description: string | null;
  price_cents: number;
  currency: string;
  class_count: number;
  validity_days: number;
  style_access: StyleAccess;
  all_styles: boolean;
  first_time_only: boolean;
  is_active: boolean;
  is_most_popular: boolean;
  sort_order: number;
  /** Optional so the app still works against a database without the monthly-billing migration. */
  billing_interval?: 'one_off' | 'monthly';
  commitment_months?: number | null;
  credit_rollover?: boolean;
  highlight?: 'recommended' | 'best_value' | null;
  cta_label?: string | null;
}

export const isMonthly = (p: Pick<MembershipPlan, 'billing_interval'>) => p.billing_interval === 'monthly';

/** Total of the initial commitment (e.g. €79 × 3 months = €237). */
export const commitmentTotalCents = (p: Pick<MembershipPlan, 'price_cents' | 'commitment_months'>) =>
  p.price_cents * (p.commitment_months ?? 1);

/** What happens to unused classes, in plain words. */
export function creditRule(p: Pick<MembershipPlan, 'billing_interval' | 'credit_rollover' | 'commitment_months' | 'validity_days'>): string {
  if (!isMonthly(p)) return `Unused classes expire ${durationLabel(p.validity_days)} after activation.`;
  return p.credit_rollover
    ? `Unused classes roll over to the next month, all through your ${p.commitment_months}-month cycle. Anything left expires when the cycle ends.`
    : 'Unused classes expire at the end of each billing month. No rollover.';
}

/** "€79 / month" or "€35". */
export const priceLabel = (p: Pick<MembershipPlan, 'price_cents' | 'currency' | 'billing_interval'>) =>
  isMonthly(p) ? `${formatPrice(p.price_cents, p.currency)} / month` : formatPrice(p.price_cents, p.currency);

export const classesLabel = (n: number) => `${n} ${n === 1 ? 'class' : 'classes'}`;

export const styleAccessLabel = (access: StyleAccess) =>
  access === 'single' ? 'One dance style' : 'Multiple dance styles';

export function durationLabel(days: number): string {
  if (days % 7 === 0) {
    const w = days / 7;
    return `${w} ${w === 1 ? 'week' : 'weeks'}`;
  }
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export const validityLabel = (days: number) => `Valid for ${durationLabel(days)} after activation.`;

export const pricePerClass = (plan: Pick<MembershipPlan, 'price_cents' | 'class_count' | 'currency'>) =>
  formatPrice(Math.round(plan.price_cents / plan.class_count), plan.currency, { forceDecimals: true });

export function sortPlans<T extends Pick<MembershipPlan, 'sort_order' | 'price_cents'>>(plans: T[]): T[] {
  return [...plans].sort((a, b) => a.sort_order - b.sort_order || a.price_cents - b.price_cents);
}

/** Badges are opt-in data, never inferred from price. */
export function planBadges(plan: Pick<MembershipPlan, 'display_label' | 'is_most_popular'>): string[] {
  const badges: string[] = [];
  if (plan.display_label) badges.push(plan.display_label);
  if (plan.is_most_popular) badges.push('Most Popular');
  return badges;
}

/** "10th": the day of the month a monthly membership is billed. */
export function ordinalDay(d: Date, tz = 'Europe/Dublin'): string {
  const n = Number(new Intl.DateTimeFormat('en-IE', { timeZone: tz, day: 'numeric' }).format(d));
  const s = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
  return `${n}${s}`;
}
