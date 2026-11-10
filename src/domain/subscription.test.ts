import { describe, expect, it } from 'vitest';
import { cancelPreview, endsOn, outOfClasses, type Subscription } from './subscription';

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's', status: 'active', end_reason: null, periods_paid: 1, total_periods: 3, next_billing_on: '2026-12-10',
  current_period_ends_on: '2026-12-10', cancel_effective_on: null, provider_cancel_sent_at: null,
  plan_snapshot: { plan_name: 'Committed', price_cents: 7900, currency: 'EUR', class_count: 8, commitment_months: 3, credit_rollover: false },
  created_at: '2026-11-10T10:00:00Z', ...over,
});
const used = { state: 'used_up', classes_remaining: 0, admin_status: 'valid' };

describe('cancelling (72 hours before the next payment)', () => {
  it('with enough notice: no more payments, ends on the next payment date', () => {
    expect(cancelPreview(sub(), new Date('2026-12-06T12:00:00Z'))).toEqual({ paymentsLeft: 0, endsOn: '2026-12-10' });
  });
  it('too late: the next payment is taken, then it ends a month later', () => {
    expect(cancelPreview(sub(), new Date('2026-12-08T12:00:00Z'))).toEqual({ paymentsLeft: 1, endsOn: '2027-01-10' });
    expect(cancelPreview(sub({ next_billing_on: '2027-01-31' }), new Date('2027-01-30T12:00:00Z')).endsOn).toBe('2027-02-28');
  });
  it('after the last payment it simply ends with the month', () => {
    expect(cancelPreview(sub({ next_billing_on: null, current_period_ends_on: '2027-02-10' }))).toEqual({ paymentsLeft: 0, endsOn: '2027-02-10' });
    expect(endsOn(sub({ next_billing_on: null, periods_paid: 3, current_period_ends_on: '2027-02-10' }))).toBe('2027-02-10');
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
  });
});
