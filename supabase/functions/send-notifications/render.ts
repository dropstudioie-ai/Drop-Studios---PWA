// Message templates for queued notifications.

export interface Claimed {
  id: number;
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
  email: string | null;
  full_name: string | null;
}

export interface Message {
  subject: string;
  text: string;
  url: string;
}

const TZ = 'Europe/Dublin';

const when = (iso: unknown) =>
  new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(String(iso)));
const day = (iso: unknown) => {
  // expires_at is the midnight that ends the last valid day.
  const d = new Date(new Date(String(iso)).getTime() - 60_000);
  return new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
};

export function render(n: Pick<Claimed, 'kind' | 'payload' | 'full_name'>): Message | null {
  const hi = n.full_name ? `Hi ${n.full_name.split(' ')[0]},` : 'Hi,';
  const p = n.payload;
  switch (n.kind) {
    case 'membership_expiring': {
      const left = Number(p.classes_remaining);
      return {
        subject: `Your ${p.plan_name} expires soon`,
        text: `${hi}\n\nYour ${p.plan_name} is valid until ${day(p.expires_at)} and you still have ${left} ${left === 1 ? 'class' : 'classes'} left. Book them before they expire:\n${Deno.env.get('SITE_URL') ?? ''}/timetable\n\nSee you on the floor!\nDrop Studios`,
        url: '/timetable',
      };
    }
    case 'class_cancelled': {
      const outcome = p.ticket_refund
        ? 'We will refund your ticket. Please allow a few days for it to appear.'
        : p.class_returned ? 'The class has been returned to your membership.' : '';
      return {
        subject: `Cancelled: ${p.title}, ${when(p.starts_at)}`,
        text: `${hi}\n\nSorry, ${p.title} on ${when(p.starts_at)} has been cancelled${p.reason ? `: ${p.reason}` : '.'}\n${outcome}\n\nBook another class: ${Deno.env.get('SITE_URL') ?? ''}/timetable\n\nDrop Studios`,
        url: '/account',
      };
    }
    default:
      return null;
  }
}
