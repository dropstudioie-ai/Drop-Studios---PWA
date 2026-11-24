import { supabase } from './supabase';
import { unwrap } from '../api';

/** A cancelled paid class (Drop In or ticket): the member chooses a class credit or a refund. */
export interface TicketChoice {
  id: string; booking_id: string; user_id: string; amount_cents: number; class_title: string; class_starts_at: string;
  status: 'waiting' | 'credit' | 'refund' | 'refunded' | 'refund_requested'; payment_id: string; by_member: boolean; decided_at: string | null; created_at: string;
}

export const ticketChoices = {
  mine: async (userId: string) => unwrap(await supabase.from('ticket_choices').select('*').eq('user_id', userId).eq('status', 'waiting').order('created_at')) as TicketChoice[],
  choose: async (id: string, credit: boolean) => unwrap(await supabase.rpc('choose_ticket_credit_or_refund', { p_choice_id: id, p_credit: credit })) as { choice: 'credit' | 'refund'; expires_at?: string },
  open: async () => unwrap(await supabase.from('ticket_choices').select('*, member:profiles!ticket_choices_user_id_fkey(full_name)').in('status', ['waiting', 'refund', 'refund_requested']).order('created_at')) as (TicketChoice & { member: { full_name: string | null } | null })[],
  adminChoose: async (id: string, credit: boolean) => unwrap(await supabase.rpc('admin_ticket_choice', { p_choice_id: id, p_credit: credit })),
  /** Member cancels a paid Drop In (1h+ before): a class credit worth what they paid, or a refund request. */
  cancelDropIn: async (bookingId: string, credit: boolean) => unwrap(await supabase.rpc('cancel_drop_in', { p_booking_id: bookingId, p_credit: credit })) as { choice: string; expires_at?: string; credit_cents?: number },
  decideRefund: async (id: string, approve: boolean, note?: string) => unwrap(await supabase.rpc('admin_decide_refund_request', { p_choice_id: id, p_approve: approve, p_note: note ?? null })),
  markRefunded: async (id: string) => unwrap(await supabase.rpc('admin_mark_ticket_refunded', { p_choice_id: id })),
};
