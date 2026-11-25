import { supabase } from './supabase';
import { unwrap } from '../api';

export type RentalStatus = 'pending_approval' | 'awaiting_payment' | 'held' | 'confirmed' | 'cancelled' | 'declined' | 'expired' | 'released';
export interface RentalSettings { dj_cents_per_hour: number; marketing_cents_per_week: number; house_rules: string; weekday_peak_cents: number; weekday_cents: number; saturday_cents: number; saturday_offer_cents: number; sunday_cents: number; party_cents: number; cleaning_fee_cents: number; open_from_min: number; open_to_min: number; max_weeks_ahead: number; hold_minutes: number; approval_hold_hours: number }
export interface RentalQuote { addons_cents: number; dj_cents: number; marketing_cents: number; rent_cents: number; cleaning_cents: number; total_cents: number; minutes: number; lines: { rate_cents: number; minutes: number }[]; approval_reasons: string[] }
export interface Busy { starts_at: string; ends_at: string; what: 'Drop class' | 'Booked' }
export interface RentalBooking {
  id: string; user_id: string; series_id: string | null; month_key: string | null; starts_at: string; ends_at: string; is_party: boolean;
  purpose: string | null; group_name: string | null; people: number | null; status: RentalStatus; approval_reasons: string[];
  rent_cents: number; cleaning_cents: number; total_cents: number; dj_minutes: number; marketing_weeks: number; addons_cents: number; payment_id: string | null; hold_expires_at: string | null;
  admin_note: string | null; refund_cents: number | null; refund_status: string | null; created_at: string;
}
export interface AdminRental { booking_id: string; starts_at: string; ends_at: string; is_party: boolean; purpose: string | null; group_name: string | null; people: number | null; total_cents: number; renter: string | null; renter_email: string | null; renter_phone: string | null; series: boolean; reasons: string[]; status: RentalStatus; series_id: string | null; month_key: string | null; hold_expires_at: string | null; refund_cents: number | null; refund_status: string | null; paid: boolean; created_at: string }

export const REASON_LABEL: Record<string, string> = { first_time: 'first booking', outside_hours: 'outside 07:00–24:00', beyond_12_weeks: 'more than 12 weeks ahead', always_review: 'confirmed by the studio' };
export const STATUS_LABEL: Record<RentalStatus, string> = {
  pending_approval: 'Waiting for the studio to confirm', awaiting_payment: 'Waiting for payment', held: 'Kept for you: pay to confirm', confirmed: 'Confirmed',
  cancelled: 'Cancelled', declined: 'Not available', expired: 'Expired (not paid in time)', released: 'Released (not paid in time)',
};

/** A regular hire: another teacher's class that closes the studio for rental. */
export interface RentalBlock { id: string; title: string; starts_at: string; ends_at: string; confirm_by: string | null }

export const rentals = {
  settings: async () => (unwrap(await supabase.from('rental_settings').select('*').limit(1)) as RentalSettings[])[0],
  busy: async (from: Date, to: Date) => unwrap(await supabase.rpc('rental_busy', { p_from: from.toISOString(), p_to: to.toISOString() })) as Busy[],
  quote: async (start: Date, end: Date, party: boolean, djMinutes = 0, marketingWeeks = 0) => unwrap(await supabase.rpc('rental_quote', { p_start: start.toISOString(), p_end: end.toISOString(), p_party: party, p_dj_minutes: djMinutes, p_marketing_weeks: marketingWeeks })) as RentalQuote,
  request: async (o: { start: Date; end: Date; party: boolean; purpose: string; group: string; people: number | null; recurring: boolean; djMinutes: number; marketingWeeks: number }) =>
    unwrap(await supabase.rpc('request_rental', { p_start: o.start.toISOString(), p_end: o.end.toISOString(), p_party: o.party, p_purpose: o.purpose || null,
      p_group_name: o.group || null, p_people: o.people, p_recurring: o.recurring, p_accept_rules: true, p_dj_minutes: o.djMinutes, p_marketing_weeks: o.marketingWeeks })) as { booking_ids: string[]; needs_approval: boolean; reasons: string[]; total_cents: number; series_id: string | null },
  mine: async (userId: string) => unwrap(await supabase.from('rental_bookings').select('*').eq('user_id', userId).order('starts_at')) as RentalBooking[],
  reschedule: async (id: string, start: Date) => unwrap(await supabase.rpc('reschedule_rental', { p_booking_id: id, p_new_start: start.toISOString() })),
  admin: async (from: Date, to: Date) => unwrap(await supabase.rpc('admin_rentals', { p_from: from.toISOString(), p_to: to.toISOString() })) as AdminRental[],
  decide: async (id: string, approve: boolean, note: string) => unwrap(await supabase.rpc('admin_decide_rental', { p_booking_id: id, p_approve: approve, p_note: note || null })),
  access: async (bookingId: string) => unwrap(await supabase.rpc('rental_access', { p_booking_id: bookingId })) as string | null,
  blocks: async (from: Date) => unwrap(await supabase.from('rental_blocks').select('id, title, starts_at, ends_at, confirm_by').gte('ends_at', from.toISOString()).order('starts_at')) as RentalBlock[],
  decideBlocks: async (confirmBy: string, keep: boolean, title: string | null) => unwrap(await supabase.rpc('admin_decide_rental_blocks', { p_confirm_by: confirmBy, p_keep: keep, p_title: title })) as number,
  removeBlock: async (id: string) => { unwrap(await supabase.rpc('admin_remove_rental_block', { p_id: id })); },
  privateSettings: async () => (unwrap(await supabase.from('rental_private').select('*').limit(1)) as { access_code: string | null; calendar_token: string }[])[0],
  saveAccessCode: async (code: string) => { const r = await supabase.from('rental_private').update({ access_code: code || null }).eq('id', true); if (r.error) throw new Error(r.error.message); },
  calendar: async (from: Date, to: Date) => unwrap(await supabase.rpc('admin_calendar', { p_from: from.toISOString(), p_to: to.toISOString() })) as { id: string; type: 'class' | 'rental'; starts_at: string; ends_at: string; title: string; detail: string }[],
  saveSettings: async (patch: Partial<RentalSettings>) => { const r = await supabase.from('rental_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', true); if (r.error) throw new Error(r.error.message); },
};

/** "07:00", "18:30" … for every half hour of the day. */
export const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
