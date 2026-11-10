import { describe, expect, it } from 'vitest';
import { addMonths, outOfClasses, subscriptionDates, type Subscription } from './subscription';

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's', status: 'active', anchor_date: '2026-11-10', last_period_index: 0, cancel_effective_on: null, provider_cancel_sent_at: null,
  plan_snapshot: { plan_name: 'Committed', price_cents: 7900, currency: 'EUR', class_count: 8, commitment_months: 3, credit_rollover: false },
  created_at: '2026-11-10T10:00:00Z', ...over,
});
const used = { state: 'used_up', classes_remaining: 0, admin_status: 'valid' };

describe('monthly membership dates', () => {
  it('bills on the same day each month, or the last day of a shorter month (like Square)', () => {
    expect(addMonths('2026-11-10', 1)).toBe('2026-12-10');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2027-01-31', 2)).toBe('2027-03-31');
  });

  it('knows the month of the cycle, the next payment and when the cycle ends', () => {
    expect(subscriptionDates(sub({ last_period_index: 1 }))).toEqual({
      nextBilling: '2027-01-10', monthInCycle: 2, commit: 3, cycleEnds: '2027-02-10', paymentsLeftInCycle: 1,
    });
    expect(subscriptionDates(sub({ last_period_index: 3 })).monthInCycle).toBe(1);
  });
});

describe('outOfClasses', () => {
  it('stays quiet while there are classes left, or before any purchase', () => {
    expect(outOfClasses([], [])).toBeNull();
    expect(outOfClasses([{ state: 'active', classes_remaining: 2, admin_status: 'valid' }], [sub()])).toBeNull();
  });

  it('tells monthly members when their next classes arrive', () => {
    expect(outOfClasses([used], [sub()])).toMatchObject({ kind: 'subscription', nextBilling: '2026-12-10', pastDue: false });
    expect(outOfClasses([used], [sub({ status: 'past_due' })])).toMatchObject({ pastDue: true });
  });

  it('asks everyone else to renew or upgrade', () => {
    expect(outOfClasses([{ state: 'expired', classes_remaining: 1, admin_status: 'valid' }], [])).toEqual({ kind: 'renew' });
    expect(outOfClasses([used], [sub({ status: 'ended' })])).toEqual({ kind: 'renew' });
    // Cancelled and no more payments to come → renew.
    expect(outOfClasses([used], [sub({ status: 'cancel_scheduled', last_period_index: 2, cancel_effective_on: '2027-02-10' })])).toEqual({ kind: 'renew' });
  });
});
