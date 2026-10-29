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
}

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
