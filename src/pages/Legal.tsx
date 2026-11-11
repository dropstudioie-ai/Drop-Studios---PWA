import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { AppSettings } from '../api/types';
import { useAsync } from '../lib/useAsync';
import { cutoffLabel, DEFAULT_POLICY } from '../domain/booking';
import { durationLabel } from '../domain/plans';
import { formatKey } from '../domain/time';
import { DATA_PROCESSORS, POLICIES_UPDATED, STUDIO } from '../config/studio';

// Rules shown on these pages come from the live studio settings, so the text
// always matches what the booking system enforces.
type Rules = Pick<AppSettings,
  'booking_window_days' | 'cancellation_cutoff_minutes' | 'late_cancel_restores_class' | 'no_show_restores_class' |
  'activation_policy' | 'max_pause_days_per_year' | 'min_pause_days'>;

export const DEFAULT_RULES: Rules = {
  ...DEFAULT_POLICY,
  no_show_restores_class: false,
  activation_policy: 'on_purchase',
  max_pause_days_per_year: 90,
  min_pause_days: 7,
};

const who = STUDIO.legalName ? `${STUDIO.legalName}, trading as ${STUDIO.name}` : STUDIO.name;

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="text-3xl font-black sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {formatKey(POLICIES_UPDATED, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <div className="mt-8 space-y-8 text-ink-soft [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-extrabold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_p]:leading-relaxed [&_ul]:space-y-1.5">
        {children}
      </div>
      <p className="mt-10 border-t border-line pt-6 text-sm text-muted">
        Questions? Contact us at <a className="font-semibold text-brand-700" href={`mailto:${STUDIO.email}`}>{STUDIO.email}</a>
        {STUDIO.phone && <> or <a className="font-semibold text-brand-700" href={STUDIO.phoneHref}>{STUDIO.phone}</a></>}.
        {' '}See also our <Link className="font-semibold text-brand-700" to={title.startsWith('Terms') ? '/privacy' : '/terms'}>{title.startsWith('Terms') ? 'Privacy Policy' : 'Terms & Conditions'}</Link>.
      </p>
    </article>
  );
}

function useRules(): Rules {
  const s = useAsync(() => api.settings(), []);
  return s.data ?? DEFAULT_RULES;
}

export function TermsContent({ rules }: { rules: Rules }) {
  const cutoff = cutoffLabel(rules.cancellation_cutoff_minutes);
  const months = Math.round(rules.max_pause_days_per_year / 30);
  return (
    <>
      <section>
        <h2>1. About these terms</h2>
        <p>
          These terms apply when you create an account, buy a membership or ticket, or book a class with {who},
          {' '}{STUDIO.address}. By using the app you agree to them. Nothing in these terms affects your statutory rights as a consumer.
        </p>
      </section>

      <section>
        <h2>2. Your account</h2>
        <ul>
          <li>You must be at least 16 to create an account. Younger dancers must be registered by a parent or guardian, who accepts these terms on their behalf.</li>
          <li>Your account is personal. Keep your password private and don’t share your account or memberships.</li>
          <li>Please keep your details accurate so we can reach you about your classes.</li>
          <li>You need to add a clear photo of yourself to your profile before booking, so our staff can recognise you at the door.</li>
        </ul>
      </section>

      <section>
        <h2>3. Memberships</h2>
        <ul>
          <li>Memberships are prepaid class packs paid once, in euro. There is no subscription and nothing renews automatically.</li>
          <li>
            {rules.activation_policy === 'on_purchase'
              ? 'A membership is activated when your payment is confirmed.'
              : 'A membership is activated when you make your first booking with it.'}
            {' '}It is valid for the period shown on the plan and ends at the end of its last day (Irish time).
          </li>
          <li>Classes not used by the expiry date are lost. Unused classes have no cash value and are not refunded, except as described in section 8.</li>
          <li>The <strong>Intro Offer</strong> is for first-time customers only.</li>
          <li>The <strong>Single Style</strong> plan can only be used for the dance style you choose at purchase. This can’t be changed later. Multi-style plans can be used for any eligible style.</li>
          <li>Some classes, such as workshops and special events, are not included in memberships. The app tells you before you book.</li>
          <li>The price, number of classes and validity are fixed when you buy. Later price changes don’t affect memberships you already have.</li>
        </ul>
      </section>

      <section>
        <h2>4. Booking and cancelling classes</h2>
        <ul>
          <li>You can book classes up to {durationLabel(rules.booking_window_days)} in advance. Each booking uses one class from your membership.</li>
          <li>If you cancel at least <strong>{cutoff} before</strong> the class starts, the class is returned to your membership.</li>
          <li>
            {rules.late_cancel_restores_class
              ? `If you cancel later than ${cutoff} before the class, the class is still returned.`
              : `If you cancel later than ${cutoff} before the class, the class is used and not returned.`}
            {' '}
            {rules.no_show_restores_class
              ? 'If you don’t attend without cancelling, the class is returned.'
              : 'If you don’t attend without cancelling, the class is used and not returned.'}
          </li>
          <li>Classes have a limited number of spots. A booking is only confirmed once the app shows it as booked.</li>
          <li>If we cancel a class, any class used for it is returned to your membership and we’ll let you know.</li>
        </ul>
      </section>

      <section>
        <h2>5. Pausing your membership</h2>
        <ul>
          <li>You can pause an active membership for up to {months} months ({rules.max_pause_days_per_year} days) per calendar year. Each pause must be at least {rules.min_pause_days} days.</li>
          <li>Your expiry date moves back by the number of paused days.</li>
          <li>You can’t book classes during a pause, and a pause can’t include dates you’ve already booked.</li>
          <li>You can end a pause early. Your expiry date is then recalculated.</li>
        </ul>
      </section>

      <section>
        <h2>6. Drop In classes and event tickets</h2>
        <ul>
          <li>A <strong>Drop In</strong> is a one-off payment for a single class, at the price shown for that class. You don’t need a membership.</li>
          <li>Workshop and event <strong>tickets</strong> are a one-off payment for a specific event.</li>
          <li>Your spot is held for about 30 minutes while you pay and is released if payment isn’t completed.</li>
          <li>Drop Ins and tickets can’t be cancelled in the app and are not refundable, unless we cancel or reschedule the class or event, in which case we refund you.</li>
        </ul>
      </section>

      <section>
        <h2>7. Payments</h2>
        <p>
          Online payments are processed securely by Square. We never see or store your full card details.
          The final amount is shown before you pay. Payments made in the studio are recorded in your account in the same way.
        </p>
      </section>

      <section>
        <h2>8. Your right to cancel a purchase</h2>
        <ul>
          <li>You can cancel a membership bought online within <strong>14 days</strong> of buying it by emailing {STUDIO.email}.</li>
          <li>By buying, you ask us to make your membership available straight away. If you have already used classes when you cancel, we deduct their value (the price divided by the number of classes, for each class used) and refund the rest.</li>
          <li>Refunds are made to your original payment method within 14 days of your request.</li>
          <li>This right does not apply to Drop Ins or tickets, which are for a class or event on a specific date.</li>
        </ul>
      </section>

      <section>
        <h2>9. Health and safety</h2>
        <ul>
          <li>Dance and fitness classes are physically demanding. Take part at a level that is right for you and stop if you feel pain, dizziness or discomfort.</li>
          <li>Tell your instructor before class about any injury, medical condition or pregnancy. If in doubt, ask your doctor before starting.</li>
          <li>Follow your instructor’s directions and wear suitable clothing and footwear.</li>
          <li>Please look after your belongings. We can’t be responsible for items left in the studio, except where the loss is caused by our negligence.</li>
        </ul>
      </section>

      <section>
        <h2>10. Studio conduct</h2>
        <p>
          Please treat instructors and other dancers with respect. We may refuse entry to, or cancel the account of, anyone whose behaviour
          is abusive or unsafe. If we do, we refund any unused classes.
        </p>
      </section>

      <section>
        <h2>11. Changes to the timetable</h2>
        <p>
          We may change class times, instructors or the timetable. If a class you booked is cancelled, the class is returned to your membership
          (or your ticket refunded) and we’ll let you know.
        </p>
      </section>

      <section>
        <h2>12. Our responsibility to you</h2>
        <p>
          We provide our classes with reasonable care and skill. Nothing in these terms limits our liability for death or personal injury caused
          by our negligence, for fraud, or for anything else that cannot be limited by law. Otherwise we are not responsible for losses that
          were not foreseeable, and our liability for any purchase is limited to the amount you paid for it.
        </p>
      </section>

      <section>
        <h2>13. Changes to these terms</h2>
        <p>
          We may update these terms. The version in force when you bought a membership or ticket applies to that purchase. We’ll tell you about
          significant changes through the app or by email.
        </p>
      </section>

      <section>
        <h2>14. Law</h2>
        <p>
          These terms are governed by Irish law. Disputes may be brought in the Irish courts, or in the courts of the country where you live if
          you are a consumer living elsewhere in the EU.
        </p>
      </section>
    </>
  );
}

export function PrivacyContent() {
  return (
    <>
      <section>
        <h2>1. Who we are</h2>
        <p>
          {who}, {STUDIO.address}, is the controller of the personal data described here. Contact us about your data at{' '}
          <a className="font-semibold text-brand-700" href={`mailto:${STUDIO.email}`}>{STUDIO.email}</a>.
        </p>
      </section>

      <section>
        <h2>2. What we collect</h2>
        <ul>
          <li><strong>Account details:</strong> your name, email address and, if you give it, your mobile number. Your password is stored by our login provider in a protected (hashed) form; we can’t see it.</li>
          <li><strong>Date of birth:</strong> so your teacher can wish you a happy birthday, and to confirm you’re old enough to have an account. Studio staff see it; your teacher sees only that it’s your birthday (and your age that day).</li>
          <li><strong>Profile photo:</strong> the photo you add to your account, so staff can recognise you at check-in. Only you and studio staff can see it, and replacing it deletes the old one.</li>
          <li><strong>Membership and booking records:</strong> what you bought, classes remaining, activation and expiry dates, pauses, bookings, cancellations and attendance.</li>
          <li><strong>Payment records:</strong> amount, date, status and the payment reference. Card details are handled by Square and never reach us.</li>
          <li><strong>Preferences:</strong> whether you want news by email and, if you turn them on, the technical address your device uses for app notifications.</li>
          <li><strong>Staff records:</strong> notes of changes our staff make to your account (for example classes granted or a pause added), kept for accountability.</li>
        </ul>
      </section>

      <section>
        <h2>3. Why we use it</h2>
        <ul>
          <li><strong>To run your account, memberships and bookings</strong>, and to tell you about changes to your classes: necessary for our contract with you.</li>
          <li><strong>To check you in with your profile photo</strong>: our legitimate interest in making sure bookings are used by the person who made them.</li>
          <li><strong>To let teachers see who is booked into their class</strong> (name, photo, whether it’s your first class, birthdays): our legitimate interest in running safe, welcoming classes. Teachers only see the lists for the classes they teach.</li>
          <li><strong>To process payments and keep accounting records</strong>: contract and legal obligation (tax law).</li>
          <li><strong>To keep the service secure, prevent misuse and understand how classes are used</strong> (for example attendance totals): our legitimate interests in running the studio.</li>
          <li><strong>To send you reminders and updates</strong> about your classes, bookings and membership, by email and (if you allow them on your device) phone notifications. These are on by default; you can turn either off at any time in My Membership.</li>
          <li><strong>To send you news and offers</strong>: only with your consent, which you can withdraw at any time in My Membership.</li>
          <li><strong>To send app notifications</strong>: only if you turn them on, and you can turn them off in your device settings.</li>
        </ul>
      </section>

      <section>
        <h2>4. Who we share it with</h2>
        <p>We don’t sell your data or use it for advertising. We use these service providers, who process it on our instructions:</p>
        <ul>
          {DATA_PROCESSORS.map((p) => (
            <li key={p.name}><strong>{p.name}</strong>: {p.purpose} ({p.location})</li>
          ))}
        </ul>
        <p className="mt-3">
          Square also uses payment data for its own fraud-prevention and legal obligations. We may share data with authorities where the law requires it.
        </p>
      </section>

      <section>
        <h2>5. Transfers outside the EU</h2>
        <p>
          Where a provider processes data outside the European Economic Area, the transfer is protected by the EU–US Data Privacy Framework or
          the European Commission’s Standard Contractual Clauses.
        </p>
      </section>

      <section>
        <h2>6. How long we keep it</h2>
        <ul>
          <li>Account, date of birth, profile photo, membership and booking data: while your account is open. If you ask us to delete your account, we delete or anonymise it within 30 days.</li>
          <li>Payment and accounting records: 6 years, as required by Irish tax law.</li>
          <li>Email preferences: until you change them or close your account.</li>
        </ul>
      </section>

      <section>
        <h2>7. Cookies and storage on your device</h2>
        <p>
          We don’t use advertising or analytics cookies, and the app doesn’t load anything from third-party trackers. The app stores only what it
          needs to work: your login session, an offline copy of the app and timetable so it opens without a connection, and whether you dismissed
          the “install the app” message. Because this storage is strictly necessary, it doesn’t require consent.
        </p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          You can ask us for a copy of your data, to correct it, to delete it, to restrict or object to how we use it, or to receive it in a
          portable format. Email {STUDIO.email}; we’ll reply within one month. You can update your name, phone and email preferences yourself in My Membership.
        </p>
        <p className="mt-3">
          If you’re unhappy with how we handle your data, you can complain to the Data Protection Commission at{' '}
          <a className="font-semibold text-brand-700" href="https://www.dataprotection.ie" target="_blank" rel="noreferrer">dataprotection.ie</a>.
        </p>
      </section>

      <section>
        <h2>9. Children</h2>
        <p>Accounts are for people aged 16 and over. Younger dancers must be registered by a parent or guardian.</p>
      </section>

      <section>
        <h2>10. Security</h2>
        <p>
          Data is sent over encrypted connections and stored with access controls, so each customer can see only their own records and only
          authorised staff can see customer accounts.
        </p>
      </section>

      <section>
        <h2>11. Changes</h2>
        <p>We’ll update this page if how we use your data changes, and tell you about significant changes through the app or by email.</p>
      </section>
    </>
  );
}

export function Terms() {
  const rules = useRules();
  return <LegalShell title="Terms & Conditions"><TermsContent rules={rules} /></LegalShell>;
}

export function Privacy() {
  return <LegalShell title="Privacy Policy"><PrivacyContent /></LegalShell>;
}
