import { drop } from './client';
import { DROP } from '../config';

export interface DropEvent {
  id: string;
  kind: 'special_class' | 'workshop';
  status: 'pending' | 'published' | 'declined' | 'cancelled';
  title: string;
  description: string | null;
  dress_code: string | null;
  decorations: string | null;
  extras: string | null;
  instructor: string | null;
  theme: { name: string; emoji: string | null } | null;
  starts_at: string | null;
  ends_at: string | null;
  price_cents: number | null;
  member_price_cents: number | null;
  artwork_path: string | null;
  session: { id: string; title: string; starts_at: string; ends_at: string } | null;
}

export const eventStart = (e: DropEvent) => e.session?.starts_at ?? e.starts_at;
export const artworkUrl = (path: string) => `${DROP.url}/storage/v1/object/public/event-art/${path}`;

const friendly = (msg: string) => /forbidden/.test(msg) ? 'Only the event’s instructor or an admin can do that.' : msg;

export async function listEvents(isAdmin: boolean): Promise<DropEvent[]> {
  const { data, error } = await drop.rpc(isAdmin ? 'admin_events' : 'my_events');
  if (error) throw new Error(friendly(error.message));
  return (data as DropEvent[]).filter((e) => e.status !== 'declined' && e.status !== 'cancelled');
}

/** Upload the approved image and attach it to the event in the Drop app. */
export async function publishArtwork(eventId: string, png: Blob): Promise<string> {
  const path = `${eventId}/${Date.now()}.png`;
  const up = await drop.storage.from('event-art').upload(path, png, { contentType: 'image/png', upsert: false });
  if (up.error) throw new Error(friendly(up.error.message));
  const { error } = await drop.rpc('set_event_artwork', { p_event_id: eventId, p_path: path });
  if (error) throw new Error(friendly(error.message));
  return path;
}
