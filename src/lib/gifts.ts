import { supabase } from './supabase';
import { unwrap } from '../api';

export interface GiftablePlan { id: string; code: string; name: string; gift_name: string; price_cents: number; currency: string; class_count: number; validity_days: number; style_access: 'single' | 'multi'; monthly: boolean; first_time_only: boolean }
export interface GiftCard {
  id: string; code: string; status: 'pending_payment' | 'active' | 'redeemed' | 'expired' | 'cancelled';
  plan_snapshot: { plan_name: string; class_count: number; validity_days: number; style_access: string; price_cents: number; currency: string };
  buyer_id: string; recipient_name: string | null; recipient_email: string | null; message: string | null; send_on: string | null;
  recipient_emailed_at: string | null; purchased_at: string | null; friend_free: boolean; is_bonus: boolean; collect_at_reception: boolean; collected_at: string | null; expires_at: string | null; redeemed_at: string | null; redeemed_via: string | null; created_at: string;
}
export interface GiftLookup { code: string; plan_name: string; class_count: number; validity_days: number; style_access: string; status: string; expires_at: string; recipient_name: string | null; styles: { id: string; name: string }[] | null }

export interface GiftOffer { friend: boolean; buy2: boolean; ends_at: string }

export const gifts = {
  offer: async () => unwrap(await supabase.rpc('gift_offer')) as GiftOffer | null,
  send: async (id: string, name: string, email: string, message: string, sendOn: string) => unwrap(await supabase.rpc('send_gift_card', { p_gift_card_id: id, p_recipient_name: name, p_recipient_email: email, p_message: message, p_send_on: sendOn })),
  markCollected: async (id: string) => unwrap(await supabase.rpc('admin_mark_gift_collected', { p_gift_card_id: id })),
  friendPasses: async () => unwrap(await supabase.rpc('my_friend_passes')) as string[],
  bookWithFriend: async (sessionId: string, membershipId: string, guest: string) => unwrap(await supabase.rpc('book_class_with_friend', { p_session_id: sessionId, p_membership_id: membershipId, p_guest_name: guest })) as { booking_id: string; classes_remaining: number; guest_name: string },
  plans: async () => unwrap(await supabase.rpc('giftable_plans')) as GiftablePlan[],
  mine: async (userId: string) => unwrap(await supabase.from('gift_cards').select('*').eq('buyer_id', userId).neq('status', 'pending_payment').order('created_at', { ascending: false })) as GiftCard[],
  card: async (id: string) => unwrap(await supabase.from('gift_cards').select('*, buyer:profiles!gift_cards_buyer_id_fkey(full_name)').eq('id', id).maybeSingle()) as (GiftCard & { buyer: { full_name: string | null } | null }) | null,
  byPayment: async (paymentId: string) => unwrap(await supabase.from('gift_cards').select('id').eq('payment_id', paymentId).maybeSingle()) as { id: string } | null,
  lookup: async (code: string) => unwrap(await supabase.rpc('gift_card_lookup', { p_code: code })) as GiftLookup,
  redeem: async (code: string, styleId: string | null) => unwrap(await supabase.rpc('redeem_gift_card', { p_code: code, p_style_id: styleId })) as { membership_id: string; plan_name: string },
  adminRedeem: async (code: string, userId: string, styleId: string | null) => unwrap(await supabase.rpc('admin_redeem_gift_card', { p_code: code, p_user_id: userId, p_style_id: styleId })) as { membership_id: string; plan_name: string },
  all: async () => unwrap(await supabase.from('gift_cards').select('*, buyer:profiles!gift_cards_buyer_id_fkey(full_name, email), redeemer:profiles!gift_cards_redeemed_by_fkey(full_name)').neq('status', 'pending_payment').order('created_at', { ascending: false }).limit(200)) as (GiftCard & { buyer: { full_name: string | null; email: string | null } | null; redeemer: { full_name: string | null } | null })[],
};

/** Normalise what people type: "drop ab12 cd34" -> "DROP-AB12-CD34". */
export function normaliseCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('DROP') ? s.slice(4) : s;
  return body.length === 8 ? `DROP-${body.slice(0, 4)}-${body.slice(4)}` : raw.trim().toUpperCase();
}
