import { supabase, AppError, errorCode } from './supabase';
import { messageFor } from '../domain/messages';

export interface FeedbackRequest { id: string; reason: 'first_in_style' | 'every_6' | 'event'; title: string; starts_at: string; instructor: string | null; style: string | null }
export interface FeedbackItem {
  id: string; rating: number; comment: string | null; reason: string; share_ok: boolean; answered_at: string;
  title: string; starts_at: string; instructor: string | null; style: string | null; member: string | null;
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await supabase.rpc(name, args);
  if (res.error) {
    const code = errorCode(res.error);
    throw new AppError(code, code ? messageFor(code) : (res.error as { message?: string }).message ?? messageFor(null));
  }
  return res.data as T;
}

export const feedback = {
  mine: () => rpc<FeedbackRequest[]>('my_feedback_requests'),
  submit: (id: string, rating: number, comment: string, shareOk: boolean) =>
    rpc<void>('submit_feedback', { p_feedback_id: id, p_rating: rating, p_comment: comment || null, p_share_ok: shareOk }),
  staff: (days = 90) => rpc<FeedbackItem[]>('staff_feedback', { p_days: days }),
};

export const average = (items: { rating: number }[]) =>
  items.length ? Math.round((items.reduce((n, i) => n + i.rating, 0) / items.length) * 10) / 10 : null;
