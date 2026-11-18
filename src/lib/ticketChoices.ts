import { supabase } from './supabase';
import { unwrap } from '../api';

/** A cancelled paid class (Drop In or ticket): the member chooses a class credit or a refund. */
export interface TicketChoice {
  id: string; booking_id: string; user_id: string; amount_cents: number; class_title: string; class_starts_at: string;
  status: 'waiting' | 'credit' | 'refund' | 'refunded'; decided_at: string | null; created_at: string;
}

export const ticketChoices = {
  mine: async (userId: string) => unwrap(await supabase.from('ticket_choices').select('*').eq('user_id', userId).eq('status', 'waiting').order('created_at')) as TicketChoice[],
  choose: async (id: string, credit: boolean) => unwrap(await supabase.rpc('choose_ticket_credit_or_refund', { p_choice_id: id, p_credit: credit })) as { choice: 'credit' | 'refund'; expires_at?: string },
  open: async () => unwrap(await supabase.from('ticket_choices').select('*, member:profiles!ticket_choices_user_id_fkey(full_name)').in('status', ['waiting', 'refund']).order('created_at')) as (TicketChoice & { member: { full_name: string | null } | null })[],
  adminChoose: async (id: string, credit: boolean) => unwrap(await supabase.rpc('admin_ticket_choice', { p_choice_id: id, p_credit: credit })),
  markRefunded: async (id: string) => unwrap(await supabase.rpc('admin_mark_ticket_refunded', { p_choice_id: id })),
};
