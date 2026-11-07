// Maps server error/issue codes (raised by the database functions) to
// customer-friendly text.
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Please log in to continue.',
  forbidden: 'You don’t have permission to do that.',
  session_not_found: 'We couldn’t find that class.',
  session_cancelled: 'This class has been cancelled.',
  session_started: 'This class has already started.',
  outside_booking_window: 'Bookings open 3 weeks before each class.',
  already_booked: 'You’re already booked into this class.',
  session_full: 'This class is fully booked.',
  no_membership: 'You need a membership to book classes.',
  membership_not_found: 'Membership not found.',
  membership_cancelled: 'This membership has been cancelled.',
  membership_expired: 'Your membership has expired.',
  no_classes_left: 'You have no classes left on your membership.',
  class_after_expiry: 'This class is after your membership expires.',
  membership_paused: 'Your membership is paused. Resume it to book classes.',
  class_in_pause: 'This class falls within your membership pause.',
  special_event: 'This is a special event with its own ticket — it isn’t included in memberships.',
  tickets_not_available: 'Tickets for this event aren’t on sale online. Please contact the studio.',
  profile_photo_required: 'Please add a profile photo to your account before booking. It helps us welcome you at the door.',
  drop_in_not_available: 'This class can’t be booked as a Drop In. Please choose a membership.',
  invalid_date_of_birth: 'Please enter a valid date of birth.',
  user_not_found: 'We couldn’t find that person.',
  instructor_not_found: 'Instructor not found.',
  ticket_contact_studio: 'Paid tickets can’t be cancelled in the app. Please contact the studio about a refund.',
  style_not_included: 'This dance style isn’t included in your membership.',
  class_excluded: 'This class isn’t included in your membership.',
  booking_not_found: 'Booking not found.',
  booking_not_active: 'This booking is no longer active.',
  plan_unavailable: 'This membership is not available right now.',
  intro_not_eligible: 'The Intro Offer is for first-time customers only.',
  intro_checkout_in_progress: 'You already have an Intro Offer checkout in progress. Please finish it or try again later.',
  style_required: 'Please choose your dance style.',
  style_not_eligible: 'That dance style isn’t available for this membership.',
  membership_not_activated: 'Your membership starts with your first booking, so there’s nothing to pause yet.',
  invalid_pause_dates: 'Please check the pause dates.',
  pause_start_in_past: 'A pause cannot start in the past.',
  pause_after_expiry: 'The pause must start before your membership expires.',
  pause_too_short: 'That pause is too short.',
  pause_already_scheduled: 'You already have a pause scheduled for this membership.',
  pause_limit_exceeded: 'That’s more than your remaining pause allowance for this year (3 months).',
  bookings_during_pause: 'You have classes booked during those dates. Cancel them first, or choose different dates.',
  no_active_pause: 'There is no active pause to end.',
  reason_required: 'Please enter a reason.',
  insufficient_classes: 'The membership doesn’t have that many classes to remove.',
  invalid_amount: 'Please enter a valid amount.',
  cannot_demote_self: 'You can’t remove your own admin access.',
  payments_not_configured: 'Online payments are not set up yet. Please contact the studio.',
  test_payments_disabled: 'Test payments are disabled on this server.',
};

export function messageFor(code: string | null | undefined, fallback = 'Something went wrong. Please try again.'): string {
  if (!code) return fallback;
  return MESSAGES[code] ?? fallback;
}

export const knownCode = (code: string) => code in MESSAGES;
