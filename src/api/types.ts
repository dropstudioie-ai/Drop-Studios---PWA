import type { MembershipPlan } from '../domain/plans';
import type { MembershipState, PauseWindow } from '../domain/membership';

export type { MembershipPlan };

export interface AppSettings {
  timezone: string;
  booking_window_days: number;
  cancellation_cutoff_minutes: number;
  late_cancel_restores_class: boolean;
  no_show_restores_class: boolean;
  activation_policy: 'on_purchase' | 'on_first_booking';
  max_pause_days_per_year: number;
  min_pause_days: number;
  expiry_reminder_days: number;
  expiry_reminders_enabled: boolean;
}

export interface DanceStyle {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  is_active: boolean;
  sort_order: number;
  drop_in_price_cents: number | null;
}

export interface Instructor {
  id: string;
  full_name: string;
  bio: string | null;
  photo_url: string | null;
  instagram: string | null;
  is_active: boolean;
}

export interface ClassTemplate {
  id: string;
  title: string;
  style_id: string;
  instructor_id: string | null;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  level: string | null;
  room: string | null;
  is_special: boolean;
  ticket_price_cents: number | null;
  is_active: boolean;
  valid_from: string;
  valid_until: string | null;
}

export interface ClassSession {
  id: string;
  template_id: string | null;
  title: string;
  style_id: string;
  instructor_id: string | null;
  starts_at: string;
  ends_at: string;
  /** Members only ever see this, never the numbers. */
  availability: Availability;
  level: string | null;
  room: string | null;
  is_special: boolean;
  ticket_price_cents: number | null;
  status: 'scheduled' | 'cancelled';
  cancel_reason: string | null;
  style?: Pick<DanceStyle, 'id' | 'name' | 'color' | 'slug'> | null;
  instructor?: Pick<Instructor, 'id' | 'full_name'> | null;
}

export type Availability = 'available' | 'almost_full' | 'full';

/** What instructors and admins see: the numbers and roster highlights. */
export interface StaffSession extends ClassSession {
  capacity: number;
  booked_count: number;
  birthdays: number;
  new_members: number;
}

export interface RosterEntry {
  booking_id: string;
  user_id: string;
  full_name: string;
  avatar_path: string | null;
  status: BookingStatus;
  class_restored: boolean;
  booked_at: string;
  kind: 'membership' | 'ticket' | 'drop_in' | 'staff';
  plan_name: string | null;
  is_new: boolean;
  is_birthday: boolean;
  turning: number | null;
}

export interface Roster {
  session_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  booked_count: number;
  status: 'scheduled' | 'cancelled';
  bookings: RosterEntry[];
}

export interface MemberMatch {
  id: string;
  full_name: string;
  email: string | null;
  avatar_path: string | null;
}

export type BookingStatus = 'booked' | 'cancelled' | 'late_cancelled' | 'attended' | 'no_show' | 'pending_payment';

export interface Booking {
  id: string;
  user_id: string;
  session_id: string;
  membership_id: string | null;
  payment_id: string | null;
  status: BookingStatus;
  class_restored: boolean;
  booked_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  session?: ClassSession;
  payment?: { kind: 'membership' | 'ticket' | 'drop_in' } | null;
}

export interface MembershipPurchase {
  id: string;
  plan_id: string;
  plan_code: string;
  plan_name: string;
  first_time_only: boolean;
  price_cents: number;
  currency: string;
  class_count: number;
  validity_days: number;
  style_access: 'single' | 'multi';
  allowed_style_ids: string[];
  selected_style_id: string | null;
  activation_policy: 'on_purchase' | 'on_first_booking';
  is_test: boolean;
  purchased_at: string;
  payment_id: string;
}

export interface MembershipPause extends PauseWindow {
  id: string;
  membership_id: string;
  original_ends_on: string;
  reason: string | null;
  created_at: string;
}

export interface Membership {
  id: string;
  user_id: string;
  plan_name: string;
  style_access: 'single' | 'multi';
  selected_style_id: string | null;
  classes_total: number;
  classes_remaining: number;
  activated_at: string | null;
  expires_at: string | null;
  base_expires_at: string | null;
  admin_status: 'valid' | 'cancelled';
  is_test: boolean;
  created_at: string;
  state: MembershipState;
  purchase: MembershipPurchase;
  pauses: MembershipPause[];
}

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: 'customer' | 'instructor' | 'admin';
  marketing_opt_in: boolean;
  avatar_path: string | null;
  date_of_birth: string | null;
  created_at: string;
}

export interface BookingOptions {
  authenticated: boolean;
  session_issue: string | null;
  my_booking_id?: string | null;
  my_booking_is_ticket?: boolean | null;
  pending_hold_booking_id?: string | null;
  ticket_price_cents?: number | null;
  drop_in_price_cents?: number | null;
  has_profile_photo?: boolean;
  eligible_membership_id?: string | null;
  memberships?: { membership_id: string; plan_name: string; state: MembershipState; classes_remaining: number; issue: string | null }[];
  alternatives?: { id: string; title: string; starts_at: string; availability: Availability }[];
  cancellation_cutoff_minutes?: number;
  late_cancel_restores_class?: boolean;
}

export interface PauseAllowance {
  year: number;
  used_days: number;
  max_days: number;
  remaining_days: number;
  min_days: number;
}
