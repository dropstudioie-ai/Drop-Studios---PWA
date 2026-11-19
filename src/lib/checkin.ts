import { supabase } from './supabase';
import { unwrap } from '../api';

export interface CheckInResult { ok: boolean; already: boolean; title: string; starts_at: string; first_name: string; first_class: boolean; birthday: boolean; turning: number | null }

export const checkin = {
  code: async (sessionId: string) => unwrap(await supabase.rpc('checkin_code', { p_session_id: sessionId })) as { code: string; valid_for: number },
  checkIn: async (sessionId: string, code: string) => unwrap(await supabase.rpc('check_in', { p_session_id: sessionId, p_code: code })) as CheckInResult,
  url: (sessionId: string, code: string) => `${window.location.origin}/checkin?s=${sessionId}&t=${code}`,
};
