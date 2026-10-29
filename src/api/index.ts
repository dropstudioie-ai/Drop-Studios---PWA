import { supabase, AppError, errorCode } from '../lib/supabase';
import { messageFor } from '../domain/messages';
import type {
  AppSettings, Booking, BookingOptions, ClassSession, DanceStyle, Instructor, Membership,
  MembershipPlan, PauseAllowance, Profile,
} from './types';

// Thin typed wrappers over Supabase. Anything that changes bookings,
// allowances or memberships is an RPC executed atomically on the server.

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const code = errorCode(res.error);
    const raw = (res.error as { message?: string }).message ?? '';
    throw new AppError(code, code ? messageFor(code) : raw || messageFor(null));
  }
  return res.data as T;
}

const SESSION_SELECT = '*, style:dance_styles(id,name,color,slug), instructor:instructors(id,full_name)';

export const api = {
  settings: async () => unwrap(await supabase.from('app_settings').select('*').single()) as AppSettings,

  styles: async () =>
    unwrap(await supabase.from('dance_styles').select('*').eq('is_active', true).order('sort_order')) as DanceStyle[],

  instructors: async () =>
    unwrap(await supabase.from('instructors').select('*').eq('is_active', true).order('full_name')) as Instructor[],

  plans: async () =>
    unwrap(await supabase.from('membership_plans').select('*').eq('is_active', true).order('sort_order')) as MembershipPlan[],

  planByCode: async (code: string) =>
    unwrap(await supabase.from('membership_plans').select('*').eq('code', code).eq('is_active', true).maybeSingle()) as MembershipPlan | null,

  planStyles: async (planId: string) =>
    (unwrap(await supabase.from('plan_styles').select('style_id').eq('plan_id', planId)) as { style_id: string }[]).map((r) => r.style_id),

  sessions: async (fromIso: string, toIso: string) =>
    unwrap(
      await supabase.from('class_sessions').select(SESSION_SELECT)
        .gte('starts_at', fromIso).lt('starts_at', toIso).order('starts_at'),
    ) as ClassSession[],

  session: async (id: string) =>
    unwrap(await supabase.from('class_sessions').select(SESSION_SELECT).eq('id', id).single()) as ClassSession,

  myBookingsBetween: async (fromIso: string, toIso: string) =>
    unwrap(
      await supabase.from('bookings').select('id, session_id, status, session:class_sessions!inner(starts_at)')
        .eq('status', 'booked').gte('session.starts_at', fromIso).lt('session.starts_at', toIso),
    ) as Pick<Booking, 'id' | 'session_id' | 'status'>[],

  myBookings: async (userId: string) =>
    unwrap(
      await supabase.from('bookings').select(`*, session:class_sessions(${SESSION_SELECT})`)
        .eq('user_id', userId).order('booked_at', { ascending: false }).limit(200),
    ) as Booking[],

  myMemberships: async (userId: string) =>
    unwrap(
      await supabase.from('memberships')
        .select('*, state, purchase:membership_purchases(*), pauses:membership_pauses(*)')
        .eq('user_id', userId).order('created_at', { ascending: false }),
    ) as Membership[],

  isFirstTimeCustomer: async () => unwrap(await supabase.rpc('is_first_time_customer')) as boolean,

  bookingOptions: async (sessionId: string) =>
    unwrap(await supabase.rpc('booking_options', { p_session_id: sessionId })) as BookingOptions,

  book: async (sessionId: string, membershipId?: string | null) =>
    unwrap(await supabase.rpc('book_class', { p_session_id: sessionId, p_membership_id: membershipId ?? null })) as {
      booking_id: string; membership_id: string; classes_remaining: number;
    },

  cancel: async (bookingId: string) =>
    unwrap(await supabase.rpc('cancel_booking', { p_booking_id: bookingId })) as {
      status: string; class_restored: boolean; late: boolean;
    },

  pauseAllowance: async (userId?: string) =>
    unwrap(await supabase.rpc('pause_allowance', { p_user_id: userId ?? null })) as PauseAllowance,

  pause: async (membershipId: string, startsOn: string, endsOn: string, reason?: string, override = false) =>
    unwrap(await supabase.rpc('pause_membership', {
      p_membership_id: membershipId, p_starts_on: startsOn, p_ends_on: endsOn,
      p_reason: reason ?? null, p_override_limits: override,
    })) as { pause_id: string; expires_at: string },

  resume: async (membershipId: string, reason?: string) =>
    unwrap(await supabase.rpc('resume_membership', { p_membership_id: membershipId, p_reason: reason ?? null })) as { expires_at: string },

  profile: async (userId: string) =>
    unwrap(await supabase.from('profiles').select('*').eq('id', userId).single()) as Profile,

  updateProfile: async (userId: string, patch: Pick<Profile, 'full_name' | 'phone' | 'marketing_opt_in'>) =>
    unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select().single()) as Profile,

  paymentStatus: async (paymentId: string) =>
    unwrap(await supabase.from('payments').select('id, status, is_test, amount_cents, currency, failure_reason').eq('id', paymentId).maybeSingle()) as {
      id: string; status: string; is_test: boolean; amount_cents: number; currency: string; failure_reason: string | null;
    } | null,
};

export { unwrap, SESSION_SELECT };
