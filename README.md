# Drop Studios — Booking PWA

Mobile-first Progressive Web App for **Drop Studios**, a dance & fitness studio in Dublin:
weekly timetable, class booking and cancellation, prepaid membership packs, customer
accounts and a studio admin dashboard.

**Stack:** React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Supabase (Postgres, Auth,
RLS, Edge Functions) · Stripe Checkout · Workbox service worker.

## Features

- **Timetable**: week view on desktop, day tabs on phones, style filters, live spots left, booking 3 weeks ahead.
- **Booking**: one tap to book, free cancellation up to 30 min before (class returned). Clear explanations and alternatives when a class isn’t included.
- **Memberships**: 3-Class Intro €35 · 4-Class Single Style €49 · 5-Class Multi-Style €55 · 8-Class Multi-Style €79 · 12-Class Multi-Style €99. All configurable data.
- **My Membership**: classes remaining, eligible styles, activation and expiry dates, pause up to 3 months a year, upcoming bookings and history.
- **Admin**: timetable, instructors, styles, plans (price, classes, validity, access, exclusions), customers (grant/revoke classes, pause, in-studio sales, roles), bookings and attendance, audit log, settings, analytics.
- **Workshops**: special events sold by ticket via Stripe, with a held spot during checkout so they can't be oversold.
- **Notifications**: expiry reminders and studio-cancelled-class messages by email (Resend) and/or web push.
- **PWA**: installable (Android prompt and iOS hint), offline shell and fallback page, cached timetable, update prompt, push notifications.

## Quick start

```bash
npm install
cp .env.example .env.local      # Supabase URL + anon key
npm run dev
```

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for Supabase, Stripe and hosting setup, and
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the design, data model and security model.

## Tests

```bash
npm run test:unit   # pricing, expiry, pause, booking-window, cancellation, eligibility messages, plan cards
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

The database suite runs the real migrations against Postgres and checks RLS isolation,
atomic booking under concurrent requests (no overspend, no overfill), double-booking
prevention, cancellation cutoffs, single- vs multi-style eligibility, exclusions, pauses,
expiry, idempotent payment fulfilment, immutable purchase terms and admin authorisation.

## Payments

Real payments use Stripe Checkout through Supabase Edge Functions. Memberships are only
activated by the signature-verified webhook. For development, `VITE_PAYMENTS_MODE=test`
plus `ALLOW_TEST_PAYMENTS=true` on the server enables a clearly labelled **TEST** checkout.
Test purchases are flagged in the database and excluded from revenue.
