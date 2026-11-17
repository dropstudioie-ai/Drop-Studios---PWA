import { supabase } from './supabase';
import { unwrap } from '../api';

export type RentalStatus = 'pending_approval' | 'awaiting_payment' | 'held' | 'confirmed' | 'cancelled' | 'declined' | 'expired' | 'released';
export interface RentalSettings { weekday_peak_cents: number; weekday_cents: number; saturday_cents: number; saturday_offer_cents: number; sunday_cents: number; party_cents: number; cleaning_fee_cents: number; open_from_min: number; open_to_min: number; max_weeks_ahead: number; hold_minutes: number; approval_hold_hours: number }
export interface RentalQuote { rent_cents: number; cleaning_cents: number; total_cents: number; minutes: number; lines: { rate_cents: number; minutes: number }[]; approval_reasons: string[] }
export interface Busy { starts_at: string; ends_at: string; what: 'Drop class' | 'Booked' }
export interface RentalBooking {
  id: string; user_id: string; series_id: string | null; month_key: string | null; starts_at: string; ends_at: string; is_party: boolean;
  purpose: string | null; group_name: string | null; people: number | null; status: RentalStatus; approval_reasons: string[];
  rent_cents: number; cleaning_cents: number; total_cents: number; payment_id: string | null; hold_expires_at: string | null;
  admin_note: string | null; refund_cents: number | null; refund_status: string | null; created_at: string;
}
export interface AdminRental { booking_id: string; starts_at: string; ends_at: string; is_party: boolean; purpose: string | null; group_name: string | null; people: number | null; total_cents: number; renter: string | null; renter_email: string | null; renter_phone: string | null; series: boolean; reasons: string[]; status: RentalStatus; series_id: string | null; month_key: string | null; hold_expires_at: string | null; refund_cents: number | null; refund_status: string | null; paid: boolean; created_at: string }

export const REASON_LABEL: Record<string, string> = { first_time: 'first booking', outside_hours: 'outside 07:00–24:00', beyond_12_weeks: 'more than 12 weeks ahead' };
export const STATUS_LABEL: Record<RentalStatus, string> = {
  pending_approval: 'Waiting for the studio to confirm', awaiting_payment: 'Waiting for payment', held: 'Kept for you: pay to confirm', confirmed: 'Confirmed',
  cancelled: 'Cancelled', declined: 'Not available', expired: 'Expired (not paid in time)', released: 'Released (not paid in time)',
};

export const rentals = {
  settings: async () => (unwrap(await supabase.from('rental_settings').select('*').limit(1)) as RentalSettings[])[0],
  busy: async (from: Date, to: Date) => unwrap(await supabase.rpc('rental_busy', { p_from: from.toISOString(), p_to: to.toISOString() })) as Busy[],
  quote: async (start: Date, end: Date, party: boolean) => unwrap(await supabase.rpc('rental_quote', { p_start: start.toISOString(), p_end: end.toISOString(), p_party: party })) as RentalQuote,
  request: async (o: { start: Date; end: Date; party: boolean; purpose: string; group: string; people: number | null; recurring: boolean }) =>
    unwrap(await supabase.rpc('request_rental', { p_start: o.start.toISOString(), p_end: o.end.toISOString(), p_party: o.party, p_purpose: o.purpose || null,
      p_group_name: o.group || null, p_people: o.people, p_recurring: o.recurring })) as { booking_ids: string[]; needs_approval: boolean; reasons: string[]; total_cents: number; series_id: string | null },
  mine: async (userId: string) => unwrap(await supabase.from('rental_bookings').select('*').eq('user_id', userId).order('starts_at')) as RentalBooking[],
  reschedule: async (id: string, start: Date) => unwrap(await supabase.rpc('reschedule_rental', { p_booking_id: id, p_new_start: start.toISOString() })),
  admin: async (from: Date, to: Date) => unwrap(await supabase.rpc('admin_rentals', { p_from: from.toISOString(), p_to: to.toISOString() })) as AdminRental[],
  decide: async (id: string, approve: boolean, note: string) => unwrap(await supabase.rpc('admin_decide_rental', { p_booking_id: id, p_approve: approve, p_note: note || null })),
  saveSettings: async (patch: Partial<RentalSettings>) => { const r = await supabase.from('rental_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true); if (r.error) throw new Error(r.error.message); },
};

/** "07:00", "18:30" … for every half hour of the day. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
