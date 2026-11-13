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


const site = () => Deno.env.get('SITE_URL') ?? '';
const monthName = (d: unknown) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, month: 'long' }).format(new Date(`${String(d)}T12:00:00Z`));
const shortDay = (d: unknown) => new Intl.DateTimeFormat('en-IE', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${String(d)}T12:00:00Z`));
/** Dress code: always encouraged, never required. */
export const dressLine = (dress: unknown) => dress
  ? `\n👗 What to wear: ${dress}\nThis is encouraged, never required. Come as you are: everyone is welcome at Drop.\n`
  : '';
const eventBlock = (p: Record<string, unknown>) => {
  const lines = [`✨ ${p.title}`, `📅 ${when(p.starts_at)}${p.instructor ? ` with ${p.instructor}` : ''}`];
  if (p.kind === 'workshop' && p.price_cents != null) {
    lines.push(`🎟️ ${eur(p.price_cents)}${p.member_price_cents != null ? ` (members ${eur(p.member_price_cents)})` : ''}`);
  }
  return `${lines.join('\n')}\n${p.description ? `\n${p.description}\n` : ''}${dressLine(p.dress_code)}`;
};
const classLink = (p: Record<string, unknown>) => `/timetable?class=${p.session_id}`;

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
        subject: `Your next ${p.plan_name} payment is on ${date}`,
        text: `${hi}\n\nA quick reminder: your ${p.plan_name} membership takes its next payment of ${eur(p.price_cents)} on ${date} (payment ${p.month} of ${p.of}), and your ${p.class_count} classes for the month are added straight away.\n\nWant to stop? You can cancel with no penalty in My Membership, by email or at reception, at least 72 hours before ${date}.\n\nSee you on the floor!\nDrop Studios`,
        url: '/account',
      };
    }
    case 'subscription_ending': {
      const date = longDate(p.on);
      return {
        subject: `Your ${p.plan_name} membership ends on ${date}`,
        text: p.reward
          ? `${hi}\n\nYou've danced with us for 3 months: thank you! Your ${p.plan_name} membership ends on ${date}.\n\nSign up again and, as a thank-you, we'll add 3 free classes to use in your first 7 days.\n\nDrop Studios`
          : `${hi}\n\nYour ${p.plan_name} membership ends on ${date}. Make the most of your remaining classes before then!\n\nWant to keep dancing? You can choose a membership again at any time in the app.\n\nDrop Studios`,
        url: '/memberships',
      };
    }
    case 'loyalty_reward': {
      const first = n.full_name?.split(' ')[0] ?? '';
      return {
        subject: `${first ? `${first}, you've` : "You've"} found your rhythm! 💃`,
        text: `${first ? `${first}, you've` : "You've"} found your rhythm! 💃\n\nTo celebrate 3 months dancing at Drop, we've added 3 free classes to your account. Book any class you like in the next 7 days. Enjoy!\n\nDrop Studios`,
        url: '/timetable',
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
    case 'class_changed': {
      const changes: string[] = [];
      if (p.time_changed) changes.push(`New time: ${when(p.starts_at)} (was ${when(p.old_starts_at)})`);
      if (p.instructor_changed) changes.push(`New instructor: ${p.instructor ?? 'to be confirmed'}${p.old_instructor ? ` (was ${p.old_instructor})` : ''}`);
      if (p.title !== p.old_title) changes.push(`Class: ${p.title} (was ${p.old_title})`);
      return {
        subject: `Change to your class: ${p.title}, ${when(p.starts_at)}`,
        text: `${hi}\n\nThere's a change to a class you're booked into:\n\n${changes.join('\n')}\n${p.note ? `\n${p.note}\n` : ''}\nYou're still booked in. Can't make it now? You can cancel in the app (My Membership) and, if it's in time, your class is returned.\n\nDrop Studios`,
        url: '/account',
      };
    }
    case 'payment_receipt': {
      const paid = new Intl.DateTimeFormat('en-IE', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(String(p.paid_at)));
      const lines = [
        `Receipt no.: ${p.receipt_no}`,
        `Date: ${paid}`,
        `Membership: ${p.plan_name}${p.month ? ` (payment ${p.month} of ${p.of})` : ''}`,
        `Classes: ${p.classes}`,
        `Amount paid: ${eur(p.amount_cents)}`,
        `Paid by: ${p.provider === 'manual' ? 'at the studio' : 'card (Square)'}`,
      ];
      const next = p.next_billing_on ? `\nYour next payment of ${eur(p.amount_cents)} is on ${longDate(p.next_billing_on)}.\n` : '';
      return {
        subject: `Your Drop Studios receipt: ${p.plan_name}, ${eur(p.amount_cents)}`,
        text: `${hi}\n\nThank you for your payment. Here is your receipt.\n\n${lines.join('\n')}\n${next}\nDrop Studios Limited\n13 Sackville Place, Dublin 1, D01\n${Deno.env.get('SUPPORT_EMAIL') ?? ''}`,
        url: '/account',
      };
    }
    case 'event_prompt': {
      const themes = (p.themes as { name: string; emoji?: string; on?: string | null; ideas?: string }[] | undefined) ?? [];
      const list = themes.map((t) => `${t.emoji ?? '•'} ${t.name}${t.on ? ` (${shortDay(t.on)})` : ' (all month)'}${t.ideas ? `\n   Idea: ${t.ideas}` : ''}`).join('\n');
      return {
        subject: `🗓️ ${monthName(p.month)} is coming: plan a special class or workshop`,
        text: `${hi}\n\nHere's what's coming up in ${monthName(p.month)}:\n\n${list || 'No dates in the calendar, so pick your own theme!'}\n\nWant to make one of your classes special, or run a workshop or gathering? Open the app, go to Organise an event, and tell us the theme, what members could wear, any decorations the studio should get, and snacks or other ideas.\n\nWorkshops are paid events outside the timetable: a great way to earn extra and bring your community together.\n\n${site()}/teach/events\n\nDrop Studios`,
        url: '/teach/events',
      };
    }
    case 'event_announced':
      return {
        subject: p.kind === 'workshop' ? `New workshop: ${p.title}` : `Special class: ${p.title}`,
        text: `${hi}\n\n${p.instructor ?? 'Your instructor'} is organising ${p.kind === 'workshop' ? 'a workshop' : 'a special class'} and thought you'd love it:\n\n${eventBlock(p)}\nBook your spot: ${site()}${classLink(p)}\n\nDrop Studios`,
        url: classLink(p),
      };
    case 'event_details':
      return {
        subject: `You're booked: ${p.title}, ${when(p.starts_at)}`,
        text: `${hi}\n\nYou're booked into a ${p.kind === 'workshop' ? 'workshop' : 'special themed class'}. Here's what to know:\n\n${eventBlock(p)}\nSee you there!\nDrop Studios`,
        url: classLink(p),
      };
    case 'event_reminder':
      return {
        subject: `Tomorrow: ${p.title}`,
        text: `${hi}\n\nA reminder that you're booked for tomorrow:\n\n${eventBlock(p)}\nCan't make it? Cancel in the app so someone else can take your spot.\n\nDrop Studios`,
        url: classLink(p),
      };
    case 'event_rescheduled': {
      const note = p.note ? `\n${p.note}\n` : '';
      if (p.audience === 'old_class') {
        return {
          subject: `Theme moved: ${p.title} is now on ${when(p.starts_at)}`,
          text: `${hi}\n\nThe "${p.title}" theme has moved from ${p.old_class_title ?? 'your class'} on ${when(p.old_starts_at)} to ${p.class_title} on ${when(p.starts_at)}.\n${note}\nYou're still booked into ${when(p.old_starts_at)}, which now runs as a normal class. Want the themed one? Book it here: ${site()}${classLink(p)}\n\nDrop Studios`,
          url: classLink(p),
        };
      }
      if (p.audience === 'ticket') {
        return {
          subject: `New date: ${p.title} is now on ${when(p.starts_at)}`,
          text: `${hi}\n\n${p.title} has moved from ${when(p.old_starts_at)} to ${when(p.starts_at)}. Your ticket is still valid for the new date.\n${note}\nCan't make the new date? Reply to this email or tell us at reception and we'll refund your ticket.\n\nDrop Studios`,
          url: classLink(p),
        };
      }
      return {
        subject: `New date: ${p.title}, ${when(p.starts_at)}`,
        text: `${hi}\n\n${p.title} with ${p.instructor ?? 'your instructor'} has a new date: ${when(p.starts_at)} (was ${when(p.old_starts_at)}).\n${note}\nBook your spot: ${site()}${classLink(p)}\n\nDrop Studios`,
        url: classLink(p),
      };
    }
    case 'event_staff_change': {
      const what = p.action === 'cancelled'
        ? `cancelled ${p.title}${p.reason ? ` (${p.reason})` : ''}.${p.refunds ? ` ${p.refunds} ticket${Number(p.refunds) === 1 ? '' : 's'} need a refund.` : ''}`
        : `moved ${p.title} from ${when(p.old_starts_at)} to ${when(p.starts_at)}.`;
      return {
        subject: `${p.instructor} ${p.action === 'cancelled' ? 'cancelled' : 'rescheduled'}: ${p.title}`,
        text: `${hi}\n\n${p.instructor} ${what}\n\n${site()}/admin/events\n\nDrop Studios`,
        url: '/admin/events',
      };
    }
    case 'event_cancelled':
      return {
        subject: `Theme dropped: ${p.class_title}, ${when(p.starts_at)}`,
        text: `${hi}\n\nThe "${p.title}" theme for ${p.class_title} on ${when(p.starts_at)} won't go ahead${p.reason ? `: ${p.reason}` : '.'}\nThe class itself still runs as normal and you're still booked in. No need to dress up.\n\nDrop Studios`,
        url: '/account',
      };
    case 'event_organised':
      return {
        subject: `${p.instructor} organised: ${p.title}`,
        text: `${hi}\n\n${p.instructor} turned ${p.class_title} on ${when(p.starts_at)} into a special class: ${p.title}.\n${p.dress_code ? `\nWhat to wear: ${p.dress_code}` : ''}\nDecorations for the studio to get: ${p.decorations ?? 'none'}\nSnacks and other ideas: ${p.extras ?? 'none'}\n\n${site()}/admin/events\n\nDrop Studios`,
        url: '/admin/events',
      };
    case 'event_request':
      return {
        subject: `Workshop request: ${p.title}`,
        text: `${hi}\n\n${p.instructor} would like to run a workshop: ${p.title}, ${when(p.starts_at)}.\nPrice: ${eur(p.price_cents)}${p.member_price_cents != null ? ` (members ${eur(p.member_price_cents)})` : ''}\n\nApprove or decline it in the app: ${site()}/admin/events\n\nDrop Studios`,
        url: '/admin/events',
      };
    case 'event_decided':
      return p.approved
        ? {
          subject: `Approved: ${p.title} is on the timetable 🎉`,
          text: `${hi}\n\nYour workshop ${p.title} (${when(p.starts_at)}) is approved and on the timetable. ${Number(p.announced) || 0} people who took your classes recently have been told.${p.note ? `\n\nFrom the studio: ${p.note}` : ''}\n\nShare it with your community: ${site()}/teach/events\n\nDrop Studios`,
          url: '/teach/events',
        }
        : {
          subject: `Workshop not approved: ${p.title}`,
          text: `${hi}\n\nSorry, the studio couldn't approve ${p.title} (${when(p.starts_at)}).${p.note ? `\n\n${p.note}` : ''}\n\nYou can suggest another date in the app.\n\nDrop Studios`,
          url: '/teach/events',
        };
    case 'feedback_request': {
      const why = p.reason === 'first_in_style' ? 'It was your first class in this style, so'
        : p.reason === 'event' ? 'You came to a special event, so'
        : 'You\'ve been coming regularly, so';
      return {
        subject: `⭐ How was ${p.title}?`,
        text: `${hi}\n\nThanks for dancing with us at ${p.title} (${when(p.starts_at)}${p.instructor ? ` with ${p.instructor}` : ''}).\n\n${why} we'd love to know how it went. It takes 20 seconds:\n\n${site()}/feedback/${p.feedback_id}\n\nYour instructor sees your rating and comment, but not your name.\n\nDrop Studios`,
        url: `/feedback/${p.feedback_id}`,
      };
    }
    case 'instructor_birthday_member':
      return p.phase === 'on_day'
        ? {
          subject: `🎂 It's ${p.instructor_name}'s birthday today!`,
          text: `${hi}\n\nIt's ${p.instructor_name}'s birthday today, and you're booked into their class: ${p.title} at ${when(p.starts_at)}.\n\nBring the birthday energy and help us make it a special one! 🎉\n\nDrop Studios`,
          url: '/account',
        }
        : {
          subject: `🎂 ${p.instructor_name}'s birthday is coming up`,
          text: `${hi}\n\nA little secret: ${p.instructor_name}'s birthday is on ${longDate(p.birthday)}. You're booked into their class ${p.title} on ${when(p.starts_at)}, so come ready to celebrate with them! 🎉\n\nDrop Studios`,
          url: '/account',
        };
    case 'instructor_profile_request':
      return {
        subject: '✍️ Quick favour: your bio and class description for the new Drop website',
        text: `${hi}\n\nEach class now has its own page on the Drop website and app, so new people can find us on Google and know what to expect before they come.\n\nWe wrote a first draft for ${p.styles ? `your ${p.styles} class` : 'your classes'}, but nobody describes it better than you. It takes about 5 minutes:\n\n1. Your bio: who you are, your dance background and what people love about your classes.\n2. Your class: what it's like, the level, what to wear, anything to bring, and tips for someone's first time.\n\nOpen this link, check the draft and change anything you like:\n${site()}/teach/profile\n\nThank you!\nDrop Studios`,
        url: '/teach/profile',
      };
    case 'membership_cancelled': {
      const n = Number(p.bookings_cancelled) || 0;
      return {
        subject: `Your ${p.plan_name} has been cancelled`,
        text: `${hi}\n\nAs agreed, your ${p.plan_name} has been cancelled${p.reason ? ` (${p.reason})` : ''}.${n ? `\nYour ${n} upcoming booking${n === 1 ? ' has' : 's have'} been cancelled too.` : ''}\n\nIf this doesn't look right, just reply to this email or talk to us at reception.\n\nDrop Studios`,
        url: '/account',
      };
    }
    case 'test_message':
      return {
        subject: 'Drop Studios: notifications are working ✅',
        text: `${hi}\n\nThis is a test message from the Drop Studios app. If you can read it, email (and, if enabled, phone) notifications are set up correctly.\n\nDrop Studios`,
        url: '/account',
      };
    default:
      return null;
  }
}
