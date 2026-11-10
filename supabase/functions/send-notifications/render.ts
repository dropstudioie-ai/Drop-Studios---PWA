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

const eur = (cents: unknown) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
const longDate = (d: unknown) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  .format(new Date(`${String(d)}T12:00:00Z`));

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
    case 'member_birthday': {
      const first = String(p.member_name ?? 'A member').split(' ')[0];
      const turning = Number(p.turning) > 0 ? ` (turning ${p.turning})` : '';
      const time = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(String(p.starts_at)));
      return p.phase === 'ten_min'
        ? {
          subject: `🎂 ${first}'s birthday: ${p.title} starts in 10 minutes`,
          text: `${hi}\n\n${p.member_name}${turning} has a birthday today and is in your ${p.title} class at ${time}.\n\nDrop Studios`,
          url: '/teach',
        }
        : {
          subject: `🎂 ${first}'s birthday is at your ${p.title} class`,
          text: `${hi}\n\n${p.member_name}${turning} is booked into your ${p.title} class on ${when(p.starts_at)}, and it's their birthday that day.\n\nDrop Studios`,
          url: '/teach',
        };
    }
    case 'subscription_payment_failed': {
      const price = eur(p.price_cents);
      return {
        subject: `We couldn't take your ${p.plan_name} payment`,
        text: `${hi}\n\nYour monthly ${p.plan_name} payment of ${price} didn't go through, so this month's classes haven't been added yet.\n\nSquare has emailed you a link to pay. Once it's paid, your classes appear in the app straight away. If your card has changed, please pay with the new card from that email or contact us at ${Deno.env.get('SUPPORT_EMAIL') ?? 'the studio'}.\n\nDrop Studios`,
        url: '/account',
      };
    }
    case 'subscription_renewing': {
      const date = longDate(p.on);
      return {
        subject: `Your ${p.plan_name} renews on ${date}`,
        text: `${hi}\n\nYour ${p.plan_name} membership renews for another ${p.commitment_months} months on ${date}: ${eur(p.price_cents)} a month for ${p.class_count} classes a month.\n\nNothing to do if you'd like to keep dancing with us. If you don't want to renew, cancel in My Membership before ${date}.\n\nDrop Studios`,
        url: '/account',
      };
    }
    case 'subscription_ending': {
      const date = longDate(p.on);
      return {
        subject: `Your ${p.plan_name} ends on ${date}`,
        text: `${hi}\n\nAs requested, your ${p.plan_name} membership ends on ${date} and won't renew. Make the most of your remaining classes before then!\n\nWant to keep dancing? You can choose a membership again at any time in the app.\n\nDrop Studios`,
        url: '/memberships',
      };
    }
    case 'subscription_ended_unexpectedly': {
      return {
        subject: `Membership stopped by Square: ${p.member_name ?? 'a member'}`,
        text: `${hi}\n\n${p.member_name ?? 'A member'}'s ${p.plan_name} monthly membership was stopped by Square (status ${p.provider_status}), not by the member or the studio. This usually means their customer details or card on file need attention in the Square Dashboard.\n\nDrop Studios`,
        url: `/admin/customers?user=${p.user_id}`,
      };
    }
    case 'payment_review': {
      const amount = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(Number(p.amount_cents) / 100);
      return {
        subject: `Payment to review: ${p.member_name ?? 'a member'} paid an old checkout`,
        text: `${hi}\n\n${p.member_name ?? 'A member'} paid ${amount} for ${p.plan_name} on a checkout that had already been replaced or cancelled (for example, in an old browser tab). The payment was accepted and the membership created.\n\nPlease check their account: if they now have two of the same purchase (such as a second Intro Offer), refund one in the Square Dashboard and adjust their classes. Then mark the payment as reviewed in Admin → Customers.\n\nDrop Studios`,
        url: `/admin/customers?user=${p.user_id}`,
      };
    }
    case 'instructor_birthday': {
      // birthday is a plain date (YYYY-MM-DD); format it at noon UTC so no time zone shifts the day.
      const date = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
        .format(new Date(`${String(p.birthday)}T12:00:00Z`));
      const turning = Number(p.turning) > 0 ? ` (turning ${p.turning})` : '';
      return p.phase === 'on_day'
        ? {
          subject: `🎂 It's ${p.instructor_name}'s birthday today`,
          text: `${hi}\n\nIt's ${p.instructor_name}'s birthday today${turning}. Don't forget to wish them a happy birthday!\n\nDrop Studios`,
          url: '/admin/instructors',
        }
        : {
          subject: `🎂 ${p.instructor_name}'s birthday is in a week`,
          text: `${hi}\n\n${p.instructor_name}'s birthday is next ${date}${turning}. You have a week to plan something.\n\nDrop Studios`,
          url: '/admin/instructors',
        };
    }
    default:
      return null;
  }
}
