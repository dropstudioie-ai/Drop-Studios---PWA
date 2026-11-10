import type { AppSettings } from '../api/types';
import { cutoffLabel } from '../domain/booking';
import { durationLabel } from '../domain/plans';
import { CheckIcon } from './icons';

/** Expiry and cancellation rules, shown before purchase. */
export function MembershipTerms({ settings, compact = false, monthly = false, oneOff = true }: {
  settings: AppSettings; compact?: boolean; monthly?: boolean; oneOff?: boolean;
}) {
  const items = monthly ? [
    'Monthly memberships are billed every month to the card you pay with. Your classes for the month are added as soon as each payment goes through.',
    'Every monthly membership has a 3-month minimum and then renews for another 3 months unless you cancel. We remind you a week before it renews.',
    'Cancel any time in My Membership: you keep your classes and pay until the end of your current 3-month period, and it won\u2019t renew.',
    'Single Style, Multi-Style and Committed: unused classes expire at the end of each billing month. All In: unused classes roll over until the end of your 3-month period.',
    `Book classes up to ${durationLabel(settings.booking_window_days)} in advance.`,
    `Cancel at least ${cutoffLabel(settings.cancellation_cutoff_minutes)} before a class to get that class back.${
      settings.late_cancel_restores_class ? '' : ' Later cancellations and no-shows use up the class.'}`,
    ...(oneOff ? ['The Intro Offer is a one-off payment: no subscription and no automatic renewal.'] : []),
  ] : [
    settings.activation_policy === 'on_purchase'
      ? 'Your membership is activated as soon as your payment is confirmed. Its validity period starts then.'
      : 'Your membership is activated on your first booking. Its validity period starts then.',
    'Unused classes expire at the end of the validity period.',
    `Book classes up to ${durationLabel(settings.booking_window_days)} in advance.`,
    `Cancel at least ${cutoffLabel(settings.cancellation_cutoff_minutes)} before a class to get that class back.${
      settings.late_cancel_restores_class ? '' : ' Later cancellations and no-shows use up the class.'}`,
    `You can pause your membership for up to ${Math.round(settings.max_pause_days_per_year / 30)} months per year. Your expiry date moves back by the paused days.`,
    'One-off payment. No subscription, no automatic renewal.',
  ];
  return (
    <ul className={`space-y-2 ${compact ? 'text-sm' : 'text-sm sm:text-base'} text-ink-soft`}>
      {items.map((t) => (
        <li key={t} className="flex gap-2"><CheckIcon className="mt-0.5 shrink-0 text-success" width={18} height={18} /><span>{t}</span></li>
      ))}
    </ul>
  );
}
