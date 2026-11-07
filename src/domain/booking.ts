export interface BookingPolicy {
  booking_window_days: number;
  cancellation_cutoff_minutes: number;
  late_cancel_restores_class: boolean;
}

export const DEFAULT_POLICY: BookingPolicy = {
  booking_window_days: 21,
  cancellation_cutoff_minutes: 30,
  late_cancel_restores_class: false,
};

export function isWithinBookingWindow(startsAt: Date, now: Date, windowDays: number): boolean {
  return startsAt > now && startsAt.getTime() <= now.getTime() + windowDays * 86_400_000;
}

export const cancellationDeadline = (startsAt: Date, cutoffMinutes: number) =>
  new Date(startsAt.getTime() - cutoffMinutes * 60_000);

export const isLateCancellation = (startsAt: Date, now: Date, cutoffMinutes: number) =>
  now > cancellationDeadline(startsAt, cutoffMinutes);

export function cancellationOutcome(startsAt: Date, now: Date, policy: BookingPolicy) {
  if (now >= startsAt) return { allowed: false, restores: false, late: true } as const;
  const late = isLateCancellation(startsAt, now, policy.cancellation_cutoff_minutes);
  return { allowed: true, late, restores: !late || policy.late_cancel_restores_class } as const;
}

export const spotsLeft = (s: { capacity: number; booked_count: number }) => Math.max(s.capacity - s.booked_count, 0);

/** The only availability members see: no numbers. */
export function availabilityLabel(a: 'available' | 'almost_full' | 'full' | undefined): string | null {
  if (a === 'full') return 'Class fully booked';
  if (a === 'almost_full') return 'Class almost full';
  return null;
}

export function cutoffLabel(minutes: number): string {
  if (minutes % 60 === 0 && minutes >= 60) {
    const h = minutes / 60;
    return `${h} ${h === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}
