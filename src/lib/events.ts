import { supabase, AppError, errorCode } from './supabase';
import { messageFor } from '../domain/messages';

export interface Theme { id: string; name: string; emoji: string | null; ideas: string | null; on: string | null }
export interface ThemeMonth { month: string; themes: Theme[] }

export interface StudioEvent {
  id: string;
  kind: 'special_class' | 'workshop';
  status: 'pending' | 'published' | 'declined' | 'cancelled';
  instructor_id: string;
  instructor: string | null;
  title: string;
  description: string | null;
  dress_code: string | null;
  decorations: string | null;
  extras: string | null;
  session_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number | null;
  price_cents: number | null;
  member_price_cents: number | null;
  admin_note: string | null;
  announced_to: number;
  created_at: string;
  theme: { name: string; emoji: string | null } | null;
  session: { id: string; title: string; starts_at: string; ends_at: string; booked_count: number; capacity: number; status: string } | null;
  tickets_sold: number;
  ticket_revenue_cents: number;
  /** Square's card fees on those tickets; fees_pending = tickets whose fee Square hasn't reported yet. */
  fees_cents: number;
  fees_pending: number;
  net_revenue_cents: number;
  instructor_share_pct: number;
  instructor_earnings_cents: number;
  studio_earnings_cents: number;
}

export interface BusySlot { title: string; starts_at: string; ends_at: string; pending: boolean }

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await supabase.rpc(name, args);
  if (res.error) {
    const code = errorCode(res.error);
    throw new AppError(code, code ? messageFor(code) : (res.error as { message?: string }).message ?? messageFor(null));
  }
  return res.data as T;
}

export const events = {
  themes: () => rpc<ThemeMonth[]>('upcoming_themes'),
  mine: () => rpc<StudioEvent[]>('my_events'),
  all: () => rpc<StudioEvent[]>('admin_events'),
  audience: (instructorId?: string) => rpc<number>('event_audience_count', { p_instructor_id: instructorId ?? null }),
  busy: (day: string) => rpc<BusySlot[]>('studio_busy', { p_day: day }),
  special: (a: { sessionId: string; title: string; description?: string; dress?: string; decorations?: string; extras?: string; themeId?: string | null }) =>
    rpc<{ event_id: string; announced: number; booked_told: number }>('organise_special_class', {
      p_session_id: a.sessionId, p_title: a.title, p_description: a.description || null, p_dress_code: a.dress || null,
      p_decorations: a.decorations || null, p_extras: a.extras || null, p_important_date_id: a.themeId ?? null,
    }),
  workshop: (a: { title: string; styleId: string; startsAt: string; endsAt: string; capacity: number; priceCents: number; memberPriceCents: number | null;
    description?: string; dress?: string; decorations?: string; extras?: string; themeId?: string | null; instructorId?: string | null }) =>
    rpc<{ event_id: string }>('request_workshop', {
      p_title: a.title, p_style_id: a.styleId, p_starts_at: a.startsAt, p_ends_at: a.endsAt, p_capacity: a.capacity,
      p_price_cents: a.priceCents, p_member_price_cents: a.memberPriceCents, p_description: a.description || null,
      p_dress_code: a.dress || null, p_decorations: a.decorations || null, p_extras: a.extras || null,
      p_important_date_id: a.themeId ?? null, p_instructor_id: a.instructorId ?? null,
    }),
  update: (id: string, d: { description: string; dress: string; decorations: string; extras: string }) =>
    rpc<void>('update_event_details', { p_event_id: id, p_description: d.description, p_dress_code: d.dress, p_decorations: d.decorations, p_extras: d.extras }),
  cancel: (id: string, reason?: string) => rpc<{ notified: number }>('cancel_event', { p_event_id: id, p_reason: reason || null }),
  decide: (id: string, approve: boolean, note?: string) =>
    rpc<{ session_id: string | null; announced: number }>('admin_decide_workshop', { p_event_id: id, p_approve: approve, p_note: note || null }),
};

/** "25" or "25.50" → cents; null when empty or invalid. */
export function euroToCents(v: string): number | null {
  const t = v.replace(',', '.').replace(/[€\s]/g, '');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}
