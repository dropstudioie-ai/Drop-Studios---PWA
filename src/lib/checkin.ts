import { supabase } from './supabase';
import { unwrap } from '../api';

export interface CheckInResult { ok: boolean; already: boolean; title: string; starts_at: string; first_name: string; first_class: boolean; birthday: boolean; turning: number | null }

export const checkin = {
  code: async (sessionId: string) => unwrap(await supabase.rpc('checkin_code', { p_session_id: sessionId })) as { code: string; valid_for: number },
  checkIn: async (sessionId: string, code: string) => unwrap(await supabase.rpc('check_in', { p_session_id: sessionId, p_code: code })) as CheckInResult,
  url: (sessionId: string, code: string) => `${window.location.origin}/checkin?s=${sessionId}&t=${code}`,
  studioCode: async () => unwrap(await supabase.rpc('studio_checkin_code')) as { code: string; valid_for: number },
  checkInStudio: async (code: string) => unwrap(await supabase.rpc('check_in_studio', { p_code: code })) as CheckInResult,
  studioUrl: (code: string) => `${window.location.origin}/checkin?studio=1&t=${code}`,
  now: async () => unwrap(await supabase.rpc('admin_checkins_now')) as { booking_id: string; full_name: string; title: string; is_new: boolean; is_birthday: boolean }[],
};
