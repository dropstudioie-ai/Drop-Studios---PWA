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
  /** 'private' plans are only shown to members the studio authorises. */
  visibility?: 'public' | 'private';
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

/** "3 monthly payments, then it stops." */
export const termLabel = (p: Pick<MembershipPlan, 'commitment_months'>) =>
  `${p.commitment_months ?? 3} monthly payments, then it stops`;

/** What happens to unused classes, in plain words. */
export function creditRule(p: Pick<MembershipPlan, 'billing_interval' | 'credit_rollover' | 'commitment_months' | 'validity_days'> & { class_count?: number }): string {
  if (isUnlimited(p.class_count)) return `Book as many classes as you like, every month, for ${p.commitment_months ?? 3} months. Then renew it yourself if you want to continue.`;
  if (!isMonthly(p)) return `Unused classes expire ${durationLabel(p.validity_days)} after activation.`;
  return p.credit_rollover
    ? `Unused classes roll over to the next month, all through your ${p.commitment_months ?? 3} months. Anything left expires when the membership ends.`
    : 'Unused classes expire at the end of each billing month. No rollover.';
}

/** "€79 / month" or "€35". */
export const priceLabel = (p: Pick<MembershipPlan, 'price_cents' | 'currency' | 'billing_interval'>) =>
  isMonthly(p) ? `${formatPrice(p.price_cents, p.currency)} / month` : formatPrice(p.price_cents, p.currency);

/** Plans with this many classes (or more) a month are unlimited; it can never be used up in a month. */
export const UNLIMITED_CLASSES = 999;
/** A membership is unlimited when its monthly allowance is UNLIMITED_CLASSES (what's left stays far above any real use). */
export const isUnlimited = (n: number | null | undefined) => (n ?? 0) >= UNLIMITED_CLASSES - 99;
export const classesLabel = (n: number) => (isUnlimited(n) ? 'Unlimited classes' : `${n} ${n === 1 ? 'class' : 'classes'}`);
/** "3 left" / "Unlimited" for what's left on a membership. */
export const leftLabel = (n: number) => (isUnlimited(n) ? 'Unlimited' : `${n} left`);

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
  isUnlimited(plan.class_count) ? '' : formatPrice(Math.round(plan.price_cents / plan.class_count), plan.currency, { forceDecimals: true });

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
