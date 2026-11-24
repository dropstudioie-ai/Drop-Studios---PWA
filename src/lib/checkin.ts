import { supabase } from './supabase';
import { unwrap } from '../api';

export interface DoorOption { session_id: string; title: string; starts_at: string; spots_left: number; is_special: boolean; membership: string | null; drop_in_price_cents: number | null }
export interface CheckInFailed { ok: false; reason: 'checkin_not_booked' | 'checkin_code_expired' | 'checkin_closed'; options: DoorOption[] }
export interface CheckInAlert { id: number; full_name: string; reason: string; at: string; title: string | null }
export interface CheckInResult { ok: true; already: boolean; title: string; starts_at: string; first_name: string; first_class: boolean; birthday: boolean; turning: number | null }

export const checkin = {
  code: async (sessionId: string) => unwrap(await supabase.rpc('checkin_code', { p_session_id: sessionId })) as { code: string; valid_for: number },
  checkIn: async (sessionId: string, code: string) => unwrap(await supabase.rpc('check_in', { p_session_id: sessionId, p_code: code })) as CheckInResult | CheckInFailed,
  url: (sessionId: string, code: string) => `${qrOrigin()}/checkin?s=${sessionId}&t=${code}`,
  studioCode: async () => unwrap(await supabase.rpc('studio_checkin_code')) as { code: string; valid_for: number },
  /** Logged out: turn a fresh code into a 15-minute pass that survives logging in. */
  pass: async (sessionId: string | null, code: string, studio: boolean) => unwrap(await supabase.rpc('checkin_pass', { p_session_id: sessionId, p_code: code, p_studio: studio })) as string,
  checkInStudio: async (code: string) => unwrap(await supabase.rpc('check_in_studio', { p_code: code })) as CheckInResult | CheckInFailed,
  bookAndCheckIn: async (sessionId: string, code: string, studio: boolean) => unwrap(await supabase.rpc('book_and_check_in', { p_session_id: sessionId, p_code: code, p_studio: studio })) as CheckInResult,
  alerts: async (sessionId: string) => unwrap(await supabase.rpc('checkin_alerts', { p_session_id: sessionId })) as CheckInAlert[],
  adminAlerts: async () => unwrap(await supabase.rpc('admin_checkin_alerts')) as CheckInAlert[],
  studioUrl: (code: string) => `${qrOrigin()}/checkin?studio=1&t=${code}`,
  now: async () => unwrap(await supabase.rpc('admin_checkins_now')) as { booking_id: string; full_name: string; title: string; is_new: boolean; is_birthday: boolean }[],
};

export const ALERT_REASON: Record<string, string> = {
  checkin_not_booked: 'isn’t booked into this class',
  checkin_code_expired: 'scanned an old code (a screenshot?)',
  checkin_closed: 'scanned outside check-in time',
};

/** QR codes always point at the main site (so the phone camera and the app agree), except when testing locally. */
export function qrOrigin() {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' ? window.location.origin : 'https://www.dropstudios.ie';
}

/** A scanned QR is a Drop check-in code if it's /checkin on any of Drop's addresses. Returns the in-app path. */
export function checkinPathFromQr(text: string): string | null {
  try {
    const u = new URL(text.trim());
    const h = u.hostname;
    const ours = (typeof window !== 'undefined' && h === window.location.hostname) || h === 'dropstudios.ie' || h.endsWith('.dropstudios.ie') || (h.endsWith('.vercel.app') && h.includes('drop'));
    return ours && u.pathname.replace(/\/$/, '') === '/checkin' && u.searchParams.get('t') ? u.pathname.replace(/\/$/, '') + u.search : null;
  } catch { return null; }
}
