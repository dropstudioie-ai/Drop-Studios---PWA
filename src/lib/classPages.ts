import { supabase, AppError, errorCode } from './supabase';
import { messageFor } from '../domain/messages';

export interface StyleDetails {
  description: string | null; level: string | null; what_to_wear: string | null; what_to_bring: string | null; first_class: string | null;
}
export interface ClassPageData {
  style: StyleDetails & { id: string; name: string; slug: string; color: string; drop_in_price_cents: number | null };
  instructors: { id: string; full_name: string; bio: string | null; instagram: string | null; photo_url: string | null }[];
  weekly: { weekday: number; start_time: string; duration_minutes: number; title: string; instructor: string | null; instructor_id: string | null }[];
}
export interface TeachingProfile {
  todo: boolean;
  instructor: { id: string; full_name: string; bio: string | null; instagram: string | null; bio_confirmed: boolean };
  styles: (StyleDetails & { id: string; name: string; slug: string; details_confirmed: boolean })[];
}

async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await supabase.rpc(name, args);
  if (res.error) {
    const code = errorCode(res.error);
    throw new AppError(code, code ? messageFor(code) : (res.error as { message?: string }).message ?? messageFor(null));
  }
  return res.data as T;
}

export const classPages = {
  page: (slug: string) => rpc<ClassPageData | null>('class_page', { p_slug: slug }),
  mine: () => rpc<TeachingProfile | null>('my_teaching_profile'),
  saveBio: (bio: string, instagram: string) => rpc<void>('save_my_bio', { p_bio: bio, p_instagram: instagram || null }),
  saveStyle: (styleId: string, d: StyleDetails) => rpc<void>('save_style_details', {
    p_style_id: styleId, p_description: d.description ?? '', p_level: d.level, p_what_to_wear: d.what_to_wear,
    p_what_to_bring: d.what_to_bring, p_first_class: d.first_class,
  }),
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Sets the page title and meta description for search engines and link previews. */
export function setPageMeta(title: string, description: string) {
  document.title = title;
  let m = document.querySelector('meta[name="description"]');
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'description'); document.head.appendChild(m); }
  m.setAttribute('content', description.slice(0, 160));
}
