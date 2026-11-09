import { describe, expect, it } from 'vitest';
import { renewalLink, renewalOffer } from './renewal';
import type { MembershipPlan } from './plans';

const plan = (code: string, over: Partial<MembershipPlan> = {}): MembershipPlan => ({
  id: code, code, name: code, display_label: null, short_description: null, price_cents: 4900, currency: 'EUR',
  class_count: 4, validity_days: 28, style_access: 'multi', all_styles: true, first_time_only: false,
  is_active: true, is_most_popular: false, sort_order: 0, ...over,
});
const plans = [plan('intro', { first_time_only: true }), plan('single-4', { style_access: 'single', all_styles: false }), plan('multi-8')];
const now = new Date('2026-11-10T12:00:00Z');
const m = (over: Record<string, unknown> = {}) => ({
  id: 'm1', plan_name: '8 Classes', expires_at: '2026-11-30T00:00:00Z', activated_at: '2026-11-01T10:00:00Z',
  classes_remaining: 0, admin_status: 'valid' as const, state: 'used_up', selected_style_id: null,
  purchase: { plan_code: 'multi-8', first_time_only: false }, ...over,
});

describe('renewalOffer', () => {
  it('offers the same plan when all classes are used before the expiry date', () => {
    const o = renewalOffer([m()], plans, now)!;
    expect(o.plan?.code).toBe('multi-8');
    expect(renewalLink(o)).toBe('/checkout/multi-8?renew=1');
  });

  it('keeps the dance style of a single-style plan', () => {
    const o = renewalOffer([m({ purchase: { plan_code: 'single-4', first_time_only: false }, selected_style_id: 'heels' })], plans, now)!;
    expect(renewalLink(o)).toBe('/checkout/single-4?renew=1&style=heels');
  });

  it('sends Intro Offer members to choose a plan, since the intro can only be bought once', () => {
    const o = renewalOffer([m({ purchase: { plan_code: 'intro', first_time_only: true } })], plans, now)!;
    expect(o.plan).toBeNull();
    expect(renewalLink(o)).toBe('/memberships');
  });

  it('offers nothing when another membership still has classes, or when it has expired', () => {
    expect(renewalOffer([m(), m({ id: 'm2', state: 'active', classes_remaining: 2 })], plans, now)).toBeNull();
    expect(renewalOffer([m({ expires_at: '2026-11-09T00:00:00Z' })], plans, now)).toBeNull();
    expect(renewalOffer([m({ state: 'active', classes_remaining: 1 })], plans, now)).toBeNull();
  });
});
