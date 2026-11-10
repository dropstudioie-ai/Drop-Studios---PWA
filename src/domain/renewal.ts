import type { MembershipPlan } from './plans';

interface RenewableMembership {
  id: string;
  plan_name: string;
  expires_at: string | null;
  activated_at: string | null;
  classes_remaining: number;
  admin_status: 'valid' | 'cancelled';
  state: string;
  selected_style_id: string | null;
  purchase: { plan_code: string; first_time_only: boolean } | null;
  subscription_id?: string | null;
}

export interface RenewalOffer {
  /** The membership whose classes are all used but whose dates haven't run out. */
  membershipId: string;
  planName: string;
  expiresAt: string | null;
  /** The same plan to buy again, or null when it can't be bought again (e.g. the Intro Offer). */
  plan: MembershipPlan | null;
  styleId: string | null;
}

/**
 * Offer to renew early when every class is used but the membership is still
 * within its dates, and nothing else has classes left. The server decides
 * eligibility at checkout; this only chooses what to suggest.
 */
export function renewalOffer(memberships: RenewableMembership[], plans: MembershipPlan[], now = new Date()): RenewalOffer | null {
  const usable = memberships.some((m) => m.admin_status === 'valid' && m.classes_remaining > 0
    && ['active', 'pending_activation', 'paused'].includes(m.state));
  if (usable) return null;
  // Monthly members get new classes with their next payment; renewing early
  // would start a second subscription.
  if (memberships.some((m) => m.subscription_id && m.state !== 'expired')) return null;
  const used = memberships
    .filter((m) => !m.subscription_id && m.state === 'used_up' && m.admin_status === 'valid' && (!m.expires_at || new Date(m.expires_at) > now))
    .sort((a, b) => (b.expires_at ?? '').localeCompare(a.expires_at ?? ''))[0];
  if (!used) return null;
  const plan = used.purchase && !used.purchase.first_time_only
    ? plans.find((p) => p.code === used.purchase!.plan_code && p.is_active && !p.first_time_only) ?? null
    : null;
  return { membershipId: used.id, planName: used.plan_name, expiresAt: used.expires_at, plan, styleId: plan?.style_access === 'single' ? used.selected_style_id : null };
}

/** Checkout link for the renewal: same plan, same style when there is one. */
export function renewalLink(offer: RenewalOffer): string {
  if (!offer.plan) return '/memberships';
  const q = new URLSearchParams({ renew: '1' });
  if (offer.styleId) q.set('style', offer.styleId);
  return `/checkout/${offer.plan.code}?${q}`;
}
