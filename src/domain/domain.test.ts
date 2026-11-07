import { describe, expect, it } from 'vitest';
import { formatPrice, parseEurosToCents } from './money';
import { classesLabel, durationLabel, planBadges, pricePerClass, sortPlans, styleAccessLabel, validityLabel } from './plans';
import { computeExpiry, isExpiringSoon, lastValidDay, membershipState, progressLabel, totalPauseDays, validatePause } from './membership';
import { cancellationOutcome, cutoffLabel, isWithinBookingWindow, spotsLeft } from './booking';
import { addDaysToKey, daysInclusive, fmt, isoWeekday, localDateKey, ordinal, weekStartKey, zonedTime } from './time';
import { messageFor } from './messages';
import { validDob } from './profile';
import { availabilityLabel } from './booking';

const PLANS = [
  { code: 'multi-12', price_cents: 9900, class_count: 12, validity_days: 56, sort_order: 50, currency: 'EUR' },
  { code: 'intro-3', price_cents: 3500, class_count: 3, validity_days: 21, sort_order: 10, currency: 'EUR' },
  { code: 'multi-5', price_cents: 5500, class_count: 5, validity_days: 28, sort_order: 30, currency: 'EUR' },
  { code: 'single-4', price_cents: 4900, class_count: 4, validity_days: 28, sort_order: 20, currency: 'EUR' },
  { code: 'multi-8', price_cents: 7900, class_count: 8, validity_days: 28, sort_order: 40, currency: 'EUR' },
];

describe('pricing', () => {
  it('formats euro prices for Ireland', () => {
    expect(formatPrice(3500)).toBe('€35');
    expect(formatPrice(4900)).toBe('€49');
    expect(formatPrice(9900)).toBe('€99');
    expect(formatPrice(4950)).toBe('€49.50');
    expect(formatPrice(5500, 'EUR', { forceDecimals: true })).toBe('€55.00');
  });

  it('parses admin price input safely', () => {
    expect(parseEurosToCents('49')).toBe(4900);
    expect(parseEurosToCents('€49,50')).toBe(4950);
    expect(parseEurosToCents('12.345')).toBeNull();
    expect(parseEurosToCents('-5')).toBeNull();
  });

  it('orders plans by configured display order', () => {
    expect(sortPlans(PLANS).map((p) => p.code)).toEqual(['intro-3', 'single-4', 'multi-5', 'multi-8', 'multi-12']);
  });

  it('uses customer-facing class wording, not credits', () => {
    expect(PLANS.map((p) => classesLabel(p.class_count)).sort()).toEqual(['12 classes', '3 classes', '4 classes', '5 classes', '8 classes']);
    expect(classesLabel(1)).toBe('1 class');
  });

  it('describes access and validity explicitly', () => {
    expect(styleAccessLabel('single')).toBe('One dance style');
    expect(styleAccessLabel('multi')).toBe('Multiple dance styles');
    expect(validityLabel(28)).toBe('Valid for 4 weeks after activation.');
    expect(validityLabel(21)).toBe('Valid for 3 weeks after activation.');
    expect(validityLabel(56)).toBe('Valid for 8 weeks after activation.');
    expect(durationLabel(10)).toBe('10 days');
  });

  it('makes the €49 vs €55 comparison easy with per-class prices', () => {
    expect(pricePerClass(PLANS[3])).toBe('€12.25');
    expect(pricePerClass(PLANS[2])).toBe('€11.00');
  });

  it('never invents badges', () => {
    expect(planBadges({ display_label: null, is_most_popular: false })).toEqual([]);
    expect(planBadges({ display_label: 'Intro Offer', is_most_popular: false })).toEqual(['Intro Offer']);
    expect(planBadges({ display_label: null, is_most_popular: true })).toEqual(['Most Popular']);
  });
});

describe('studio time', () => {
  it('handles Dublin DST when converting wall-clock times', () => {
    expect(zonedTime('2026-07-01', 19 * 60).toISOString()).toBe('2026-07-01T18:00:00.000Z'); // IST
    expect(zonedTime('2026-12-01', 19 * 60).toISOString()).toBe('2026-12-01T19:00:00.000Z'); // GMT
    expect(zonedTime('2026-10-25', 0).toISOString()).toBe('2026-10-24T23:00:00.000Z'); // clocks change at 02:00
  });

  it('computes local dates and weeks', () => {
    expect(localDateKey(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    expect(isoWeekday('2026-10-29')).toBe(4);
    expect(weekStartKey('2026-11-01')).toBe('2026-10-26');
    expect(addDaysToKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(daysInclusive('2026-11-01', '2026-11-14')).toBe(14);
    expect(fmt.weekdayShort('2026-10-29T18:00:00Z')).toBe('Thu');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 30, 101, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '30th', '101st', '112th']);
  });
});

describe('membership expiry and lifecycle', () => {
  it('expires at the end of the local day, validity days after activation', () => {
    const activated = new Date('2026-10-01T13:00:00Z');
    const exp = computeExpiry(activated, 28);
    expect(exp.toISOString()).toBe('2026-10-30T00:00:00.000Z'); // Dublin midnight ending 29 Oct (GMT after 25 Oct)
    expect(lastValidDay(exp)).toBe('2026-10-29');
  });

  it('activation late at night uses the Dublin calendar day', () => {
    const activated = new Date('2026-07-01T23:30:00Z'); // 00:30 on 2 July in Dublin
    expect(lastValidDay(computeExpiry(activated, 21))).toBe('2026-07-23');
  });

  it('extends expiry by paused days', () => {
    const activated = new Date('2026-03-02T10:00:00Z');
    const pauses = [
      { starts_on: '2026-03-10', ends_on: '2026-03-23', is_cancelled: false },
      { starts_on: '2026-03-25', ends_on: '2026-03-31', is_cancelled: true },
    ];
    expect(totalPauseDays(pauses)).toBe(14);
    expect(lastValidDay(computeExpiry(activated, 28, totalPauseDays(pauses)))).toBe('2026-04-13');
  });

  it('derives state like the server', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    const base = { admin_status: 'valid' as const, activated_at: '2026-10-01T10:00:00Z', expires_at: '2026-11-05T00:00:00Z', classes_remaining: 3 };
    expect(membershipState(base, [], now)).toBe('active');
    expect(membershipState({ ...base, classes_remaining: 0 }, [], now)).toBe('used_up');
    expect(membershipState({ ...base, expires_at: '2026-10-29T00:00:00Z' }, [], now)).toBe('expired');
    expect(membershipState(base, [{ starts_on: '2026-10-28', ends_on: '2026-11-03', is_cancelled: false }], now)).toBe('paused');
    expect(membershipState({ ...base, activated_at: null, expires_at: null }, [], now)).toBe('pending_activation');
    expect(membershipState({ ...base, admin_status: 'cancelled' }, [], now)).toBe('cancelled');
  });

  it('shows progress as classes remaining', () => {
    expect(progressLabel(3, 5)).toBe('3 of 5 classes remaining');
  });

  it('flags memberships close to expiry', () => {
    const now = new Date('2026-10-29T12:00:00Z');
    expect(isExpiringSoon('2026-11-01T00:00:00Z', 5, now)).toBe(true);
    expect(isExpiringSoon('2026-11-20T00:00:00Z', 5, now)).toBe(false);
    expect(isExpiringSoon('2026-10-20T00:00:00Z', 5, now)).toBe(false);
  });

  it('validates pause requests', () => {
    const rules = { todayKey: '2026-10-29', expiresOnKey: '2026-11-26', minDays: 7, remainingAllowance: 90 };
    expect(validatePause('2026-11-01', '2026-11-14', rules)).toBeNull();
    expect(validatePause('2026-10-28', '2026-11-14', rules)).toMatch(/past/);
    expect(validatePause('2026-11-01', '2026-11-03', rules)).toMatch(/at least 7/);
    expect(validatePause('2026-11-26', '2026-12-10', rules)).toMatch(/before your membership expires/);
    expect(validatePause('2026-11-01', '2026-11-30', { ...rules, remainingAllowance: 20 })).toMatch(/20 pause days/);
  });
});

describe('booking rules', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const policy = { booking_window_days: 21, cancellation_cutoff_minutes: 30, late_cancel_restores_class: false };

  it('allows booking up to 3 weeks ahead', () => {
    expect(isWithinBookingWindow(new Date('2026-11-18T12:00:00Z'), now, 21)).toBe(true);
    expect(isWithinBookingWindow(new Date('2026-11-19T12:00:01Z'), now, 21)).toBe(false);
    expect(isWithinBookingWindow(new Date('2026-10-29T11:00:00Z'), now, 21)).toBe(false);
  });

  it('restores the class only when cancelling 30+ minutes before', () => {
    expect(cancellationOutcome(new Date('2026-10-29T12:31:00Z'), now, policy)).toEqual({ allowed: true, late: false, restores: true });
    expect(cancellationOutcome(new Date('2026-10-29T12:30:00Z'), now, policy)).toEqual({ allowed: true, late: false, restores: true });
    expect(cancellationOutcome(new Date('2026-10-29T12:29:00Z'), now, policy)).toEqual({ allowed: true, late: true, restores: false });
    expect(cancellationOutcome(new Date('2026-10-29T12:29:00Z'), now, { ...policy, late_cancel_restores_class: true }).restores).toBe(true);
    expect(cancellationOutcome(new Date('2026-10-29T11:59:00Z'), now, policy).allowed).toBe(false);
  });

  it('reports spots and cutoff text', () => {
    expect(spotsLeft({ capacity: 20, booked_count: 23 })).toBe(0);
    expect(cutoffLabel(30)).toBe('30 minutes');
    expect(cutoffLabel(120)).toBe('2 hours');
  });

  it('explains eligibility refusals in plain language', () => {
    expect(messageFor('style_not_included')).toMatch(/style isn’t included/);
    expect(messageFor('class_excluded')).toMatch(/isn’t included/);
    expect(messageFor('totally_unknown')).toMatch(/Something went wrong/);
  });
});

describe('member details', () => {
  it('accepts real dates of birth only', () => {
    expect(validDob('1995-06-15', '2026-11-08')).toBe(true);
    expect(validDob('2026-11-09', '2026-11-08')).toBe(false);
    expect(validDob('1899-12-31', '2026-11-08')).toBe(false);
    expect(validDob('15/06/1995', '2026-11-08')).toBe(false);
  });

  it('describes availability without numbers', () => {
    expect(availabilityLabel('available')).toBeNull();
    expect(availabilityLabel('almost_full')).toBe('Class almost full');
    expect(availabilityLabel('full')).toBe('Class fully booked');
  });
});
