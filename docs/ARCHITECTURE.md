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
      ┌──────────────┐  webhook     │  │ create-checkout · stripe-webhook ·  │  │
      │ Stripe       ├─────────────►│  │ dev-checkout (dev only)             │  │
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
| `class_sessions` | Dated, bookable classes generated from templates (or one-offs); `booked_count` maintained server-side; `is_special` = workshop needing separate payment |
| `membership_plans` | Configurable products: price (cents), classes, validity days, single/multi, first-time-only, active, “Most Popular” opt-in |
| `plan_styles` | Eligible styles when a plan isn’t “all styles” |
| `plan_exclusions` | Recurring class or single session excluded from a plan |
| `payments` | One row per checkout attempt; server-side amount, `plan_snapshot`, provider (`stripe` / `manual` / `dev_test`), `is_test`, idempotency key, Stripe references |
| `membership_purchases` | **Immutable** snapshot of the terms bought: price, classes, validity, allowed styles, excluded classes, activation policy |
| `memberships` | The live instance: classes remaining, activation, base expiry, effective expiry |
| `membership_pauses` | Pause windows (inclusive dates); expiry = base + paused days |
| `bookings` | Customer ↔ session; status booked / cancelled / late_cancelled / attended / no_show |
| `credit_transactions` | **Immutable** class-allowance ledger (+grant, −booking, +refunds, admin grant/revoke with reason) |
| `audit_log` | **Immutable** record of admin and configuration actions (config tables are audited by trigger) |
| `notification_outbox` | Queued notifications (e.g. expiry reminders) for a sender worker |
| `push_subscriptions` | Web-push endpoints per user (groundwork) |

“Credits” exist only internally (`classes_remaining`, `credit_transactions`);
customers always see “classes”.

## Purchase → membership flow

1. Checkout page → `create-checkout` edge function (customer JWT).
2. `create_checkout` RPC validates the plan, first-time eligibility and style
   choice, snapshots the terms and inserts a `pending` payment priced from the
   database. Re-sending the same idempotency key returns the same payment.
3. Edge function creates a Stripe Checkout Session for exactly that amount,
   expiring old sessions first so a payment can never be paid twice.
4. Stripe → `stripe-webhook` (signature verified) → `fulfill_payment`
   (service role only). It locks the payment, verifies the amount and currency,
   marks it succeeded and creates purchase + membership + ledger grant once.
   Repeated webhooks are no-ops.
5. The success page polls the payment status; nothing is activated client-side.

`dev-checkout` follows the same path with provider `dev_test`. It only runs
when the server has `ALLOW_TEST_PAYMENTS=true` and no live Stripe key. Its
records are flagged `is_test`, badged **TEST** in the UI and excluded from
revenue analytics.

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
