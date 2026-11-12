# Drop Studios — Architecture

## Overview

```
┌──────────────────────────┐        ┌───────────────────────────────────────────┐
│  PWA (React + Vite)      │  anon  │  Supabase                                 │
│  • Home / Timetable      │  key   │  ┌─────────────┐   ┌───────────────────┐  │
│  • Memberships/Checkout  ├───────►│  │ Auth (JWT)  │   │ PostgREST         │  │
│  • My Membership         │        │  └─────────────┘   │  • reads under RLS│  │
│  • Admin                 │        │                    │  • RPCs (writes)  │  │
│  Service worker:         │        │  ┌─────────────────┴───────────────────┐  │
│  offline shell, cached   │        │  │ Postgres: schema, RLS, SECURITY     │  │
│  timetable, push hooks   │        │  │ DEFINER business functions, pg_cron │  │
└────────────┬─────────────┘        │  └─────────────────▲───────────────────┘  │
             │ redirect             │  ┌─────────────────┴───────────────────┐  │
             ▼                      │  │ Edge Functions (Deno)               │  │
      ┌──────────────┐  webhook     │  │ create-checkout · square-webhook ·  │  │
      │ Square       ├─────────────►│  │ dev-checkout (dev only)             │  │
      │ Checkout     │              │  └─────────────────────────────────────┘  │
      └──────────────┘              └───────────────────────────────────────────┘
```

**Trust boundary.** The browser holds only the public anon key. Customers can
*read* their own rows (RLS) but cannot write memberships, bookings, payments or
the class ledger directly. Table privileges are revoked. Every change goes
through a `SECURITY DEFINER` function that re-checks identity and rules, locks
the rows involved, and either commits everything or nothing. Prices, remaining
classes and expiry dates are always computed in the database.

## Key rules and where they live

| Rule | Server (authoritative) | Client mirror (display / tests) |
|---|---|---|
| Book ≤ 3 weeks ahead | `_session_issue` (`app_settings.booking_window_days`) | `domain/booking.ts` |
| Cancel ≥ 30 min before → class returned | `_cancel_booking` (`cancellation_cutoff_minutes`) | `cancellationOutcome` |
| Late cancel / no-show policy | `late_cancel_restores_class`, `no_show_restores_class` | Terms text |
| Expiry = end of local day (activation + validity + paused days) | `compute_expiry` | `computeExpiry` |
| Activation on purchase or first booking | `app_settings.activation_policy`, snapshotted per purchase | Checkout text |
| Single-style / multi-style / exclusions / special events | `_membership_issue` | Messages map |
| Pause ≤ 90 days per calendar year, min 7 days, no bookings in window | `pause_membership` | `validatePause` |
| No double booking | partial unique index + row locks | — |
| No overspend / overfill | `FOR UPDATE` on session then membership(s) | — |
| Intro = first-time customers | `_plan_snapshot` / `is_first_time_customer` | Disabled card |

Times are evaluated in `Europe/Dublin` (`app_settings.timezone`), including DST.

## Data model

| Table | Purpose |
|---|---|
| `profiles` | 1:1 with `auth.users`; `role` = customer / instructor / admin (not client-writable) |
| `app_settings` | Single row of studio rules (window, cutoff, pause limits, activation policy…) |
| `dance_styles` | Admin-managed list of styles (seeded: FitDance, Commercial, Hip Hop, Heels, Jazz Funk, Reggaeton) |
| `instructors` | Teachers, optionally linked to a profile |
| `class_templates` | Recurring weekly classes (weekday + local start time) |
| `class_sessions` | Dated, bookable classes generated from templates (or one-offs); `booked_count` maintained server-side (includes held ticket spots); `is_special` + `ticket_price_cents` = workshop sold by ticket |
| `membership_plans` | Configurable products: price (cents), classes, validity days, single/multi, first-time-only, active, “Most Popular” opt-in |
| `plan_styles` | Eligible styles when a plan isn’t “all styles” |
| `plan_exclusions` | Recurring class or single session excluded from a plan |
| `payments` | One row per checkout attempt; `kind` membership or ticket; server-side amount, `plan_snapshot`, provider (`square` / `manual` / `dev_test`; `stripe` kept for history), `is_test`, idempotency key, Stripe references |
| `membership_purchases` | **Immutable** snapshot of the terms bought: price, classes, validity, allowed styles, excluded classes, activation policy |
| `memberships` | The live instance: classes remaining, activation, base expiry, effective expiry |
| `membership_pauses` | Pause windows (inclusive dates); expiry = base + paused days |
| `bookings` | Customer ↔ session; status booked / pending_payment (ticket hold) / cancelled / late_cancelled / attended / no_show; `payment_id` for tickets |
| `credit_transactions` | **Immutable** class-allowance ledger (+grant, −booking, +refunds, admin grant/revoke with reason) |
| `audit_log` | **Immutable** record of admin and configuration actions (config tables are audited by trigger) |
| `notification_outbox` | Queued notifications (expiry reminders, studio-cancelled classes), claimed and delivered by `send-notifications` (email via Resend, web push) |
| `push_subscriptions` | Web-push endpoints per user; expired endpoints are pruned on delivery |

“Credits” exist only internally (`classes_remaining`, `credit_transactions`);
customers always see “classes”.

## Purchase → membership flow

1. Checkout page → `create-checkout` edge function (customer JWT).
2. `create_checkout` RPC validates the plan, first-time eligibility and style
   choice, snapshots the terms and inserts a `pending` payment priced from the
   database. Re-sending the same idempotency key returns the same payment.
3. Edge function creates a Square payment link for exactly that amount
   (tipping off). Its idempotency key comes from our payment id, so retries get
   the same link and a payment record can never be paid twice. The Square order
   id is stored on the payment.
4. Square → `square-webhook` (HMAC signature over URL + body verified) →
   `fulfill_payment` (service role only) once the payment is `COMPLETED`. It
   locks the payment, verifies the amount and currency, marks it succeeded and
   creates purchase + membership + ledger grant once. Repeated events are
   no-ops; payments that don't belong to an app checkout (e.g. card-reader
   sales) are ignored.
5. The success page polls the payment status; nothing is activated client-side.

`dev-checkout` follows the same path with provider `dev_test`. It only runs
when the server has `ALLOW_TEST_PAYMENTS=true` and Square isn't set to production. Its
records are flagged `is_test`, badged **TEST** in the UI and excluded from
revenue analytics.

## Workshop tickets

`create_ticket_checkout` locks the session, releases expired holds, and inserts a
`pending_payment` booking that counts towards capacity for 35 minutes (the
customer is told about 30). Returning to the same workshop resumes that
checkout. `fulfill_payment` confirms the hold. If the hold lapsed, it re-books
when a spot is free; otherwise it records `ticket_refund_required`.
The `drop-release-holds` cron job frees abandoned spots.

## Staff views and hidden numbers

`class_sessions.booked_count` and `capacity` aren't readable by the public
(column privileges). Members get the timetable from `timetable()`, which only
reports `available` / `almost_full` (≤10 left) / `full`. Instructors are linked
to a login through `instructors.profile_id`; `staff_sessions`, `staff_roster`,
`staff_find_members` and `staff_book_member` check `can_staff_session` (admin,
or teaching that class), and bookings RLS lets an instructor read only the
bookings of their own classes. Members and staff bookings share `_book_for`, so
every booking follows the same membership rules. `queue_birthday_alerts`
(cron, every 5 min) writes one teacher notification per class, member and phase
(`dedupe_key`). Instructors without a date of birth get `dob_required` from the
staff functions until they add it; `queue_instructor_birthday_alerts` (cron,
every 15 min, from 09:00 Dublin) tells every admin a week before and on the day.

## Monthly memberships (3 monthly payments, then they stop)

Plans have `billing_interval` (`one_off` / `monthly`), `commitment_months`
(number of monthly payments, 3) and `credit_rollover`. The Intro Offer is
one-off; the other four are monthly.

- **Checkout.** `create-checkout` creates (once per plan, price, number of
  payments and Square environment) a Square SUBSCRIPTION_PLAN + single-phase
  MONTHLY variation with `periods: 3`, stored in `square_plan_variations`, and a
  payment link with `checkout_options.subscription_plan_id`. Square saves the
  card, creates the subscription, charges month 1 and completes it after 3.
- **Month 1** (tested live): Square charges it as the subscription's first
  invoice, not on the checkout order; the checkout order stays DRAFT but carries
  the buyer's `customer_id`. `invoice.payment_made` for an unknown subscription →
  the webhook finds the member's pending monthly checkout whose order has that
  customer → `fulfill_payment` → `_start_subscription` → `_issue_period(0)`, and
  links the Square subscription (fallbacks: customer already linked, then the
  customer's email). Finishes an upgrade and gives the loyalty reward if earned.
- **Months 2–3.** `invoice.payment_made` → `fulfill_subscription_charge`,
  idempotent per invoice and per month (`subscription_periods` unique per
  index). Early, extra or wrong-amount payments are accepted but flagged
  (`review_reason`) with no classes.
- **Credits.** No rollover: one `memberships` row per month, valid to the next
  payment date (+ that day); the next month expires what's left
  (`period_expired`). Rollover (All In): one row for the 3 months; months 2–3
  add classes (`grant_renewal`); it expires with the last month.
- **Cancel** (`request_subscription_cancel`): any time, no penalty. ≥72 h before
  the next payment → no more payments, Square cancel sent now; later → that
  payment is taken and the cancel is sent once it's paid.
  `admin_end_subscription_now` stops from the next payment date regardless.
- **Pause.** A trigger on `membership_pauses` moves `next_billing_on` by the
  paused days (and back if a pause is shortened). Square can't move a monthly
  payment day without risking a double charge (tested in the sandbox), so
  `manage-subscription` (`sync_billing`) cancels the Square subscription at the
  end of the paid month (`pending_restart`), and the scheduled
  `subscription-jobs` function starts a new one on the new payment date with the
  saved card for the payments left (charged that day; idempotent per date).
- **Upgrade.** With no classes left, `create_checkout` allows a dearer monthly
  plan (`upgrade_from`); on payment the old subscription ends (`upgraded`) and
  its Square subscription is cancelled.
- **Loyalty reward.** Signing up again after completing all payments of a
  previous membership: 3 classes, any style, valid 7 days (`grant_reward`), once
  per completed membership.
- **Refunds.** Admins only: `admin-refund` (checks `admin_can_refund`, finds the
  Square payment id, calls Square Refunds); the refund webhook records it.
- **Reminders** (`queue_subscription_reminders`, daily): 5 days before each
  payment, 7 days before the end; also marks finished memberships ended.

## Early renewal

When every class on a membership is used but its dates haven't run out (and no
other membership has classes left), the booking sheet and My Membership offer
**Renew early** (the same plan, and the same style for single-style plans) next
to the Drop In. `domain/renewal.ts` picks the offer; checkout and eligibility are
the normal purchase path, so the Intro Offer can't be bought again (those
members are sent to choose a plan). The new membership is independent; the used-up
one simply runs to its expiry.

## Frontend structure

```
src/
  domain/      pure business helpers (pricing labels, expiry, pause, booking rules, messages) — unit tested
  api/         typed Supabase reads + RPC wrappers
  auth/        session/profile context, route guards (UI only; DB enforces)
  components/  PlanCard, ClassCard, BookingSheet, MembershipCard, PauseSheet, Layout, PWA prompts
  pages/       Home, Timetable, Memberships, Checkout, Account, Auth, admin/*
  sw.ts        Workbox service worker: precache, offline fallback, catalogue cache, push handlers
```
