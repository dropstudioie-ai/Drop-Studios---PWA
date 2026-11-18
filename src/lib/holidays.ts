import { supabase } from './supabase';
import { unwrap } from '../api';

export interface TimeOff {
  id: string; instructor_id: string; starts_on: string; ends_on: string; note: string | null;
  status: 'pending' | 'approved' | 'declined' | 'cancelled'; admin_note: string | null; created_at: string;
}
export interface CoverNeeded {
  session_id: string; title: string; starts_at: string; ends_at: string; booked_count: number;
  instructor_id: string; instructor: string; time_off_id: string; style_id: string;
}

export const holidays = {
  mine: async () => unwrap(await supabase.from('instructor_time_off').select('*').neq('status', 'cancelled').order('starts_on', { ascending: false }).limit(20)) as TimeOff[],
  request: async (from: string, to: string, note: string) => unwrap(await supabase.rpc('request_time_off', { p_from: from, p_to: to, p_note: note })) as { id: string; classes: number },
  cancel: async (id: string) => unwrap(await supabase.rpc('cancel_time_off', { p_id: id })),
  pending: async () => unwrap(await supabase.from('instructor_time_off').select('*, instructor:instructors(full_name)').eq('status', 'pending').order('starts_on')) as (TimeOff & { instructor: { full_name: string } | null })[],
  decide: async (id: string, approve: boolean, note: string) => unwrap(await supabase.rpc('admin_decide_time_off', { p_id: id, p_approve: approve, p_note: note })) as { status: string; classes: number },
  needingCover: async () => unwrap(await supabase.rpc('admin_classes_needing_cover')) as CoverNeeded[],
};

export const STATUS_LABEL: Record<TimeOff['status'], string> = { pending: '⏳ Waiting for approval', approved: '✅ Approved', declined: 'Not approved', cancelled: 'Cancelled' };
export const range = (a: string, b: string) => {
  const f = (d: string) => new Intl.DateTimeFormat('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
  return a === b ? f(a) : `${f(a)} – ${f(b)}`;
};
