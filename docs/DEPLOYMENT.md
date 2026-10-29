# Deploying Drop Studios

## 1. Supabase project

1. Create a project at supabase.com (region: `eu-west-1` Ireland is closest).
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This applies `supabase/migrations/*`, including the five membership plans
   and the dance styles. It does **not** run `supabase/seed.sql` (local demo data).
3. Scheduled jobs: the last migration enables **pg_cron** (available on hosted
   Supabase) and schedules:
   - `drop-generate-sessions`: daily, publishes 5 weeks of classes from the weekly timetable.
   - `drop-expiry-reminders`: daily, queues reminders (when enabled in Admin → Settings).
   Check them under Database → Cron after pushing.
4. Auth settings: set **Site URL** to your domain and add
   `https://<domain>/reset-password` to the redirect URLs. Keep email
   confirmations on in production. Configure custom SMTP for branded emails.

## 2. First admin

Register through the app, then in the SQL editor:
```sql
update public.profiles set role = 'admin' where email = 'you@dropstudios.ie';
```
Further admins can be promoted from Admin → Customers.

## 3. Load the real timetable

Admin → Instructors → add the team. Then Admin → Timetable → *Add recurring
class* for each weekly class, and **Publish next 5 weeks**.

## 4. Stripe (real payments)

1. In Stripe, create a webhook endpoint
   `https://<project-ref>.supabase.co/functions/v1/stripe-webhook` for events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`.
2. Set secrets (never put these in the frontend `.env`):
   ```bash
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
     SITE_URL=https://app.dropstudios.ie ALLOWED_ORIGINS=https://app.dropstudios.ie
   ```
3. Deploy functions:
   ```bash
   npx supabase functions deploy create-checkout
   npx supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   Do **not** deploy `dev-checkout` to production (it also refuses to run with a
   live key or without `ALLOW_TEST_PAYMENTS=true`).
4. Test with `sk_test_` keys and the Stripe CLI first:
   `stripe listen --forward-to https://<project-ref>.supabase.co/functions/v1/stripe-webhook`.

Refunds: Stripe refunds mark the payment `refunded` and write an audit entry.
Whether to remove any remaining classes is a studio decision. Use Admin →
Customers → *Grant / revoke classes* with a reason.

## 5. Frontend hosting (Vercel, Netlify or Cloudflare Pages)

Build command `npm run build`, output `dist`. Environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project’s anon/public key |
| `VITE_PAYMENTS_MODE` | `stripe` |
| `VITE_VAPID_PUBLIC_KEY` | optional, for push |

SPA fallback: route all paths to `/index.html` (Vercel: a rewrite
`{"source": "/(.*)", "destination": "/index.html"}`; Netlify: `/* /index.html 200`).
Serve `sw.js` with `Cache-Control: no-cache` so updates roll out. HTTPS is
required for the service worker and install prompts.

## 6. Local development

```bash
npm install
npx supabase start            # needs Docker
npx supabase db reset         # migrations + demo seed
cp .env.example .env.local    # fill from `supabase status`; set VITE_PAYMENTS_MODE=test
cp supabase/functions/.env.example supabase/functions/.env   # ALLOW_TEST_PAYMENTS=true
npx supabase functions serve --env-file supabase/functions/.env
npm run dev
```

Tests:
```bash
npm run test:unit                                                     # domain + components
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```
The database suite creates a throwaway database, applies the real migrations
over a small Supabase shim (`auth.uid()`, roles) and runs as
`anon` / `authenticated` / `service_role`.

## 7. Not yet wired (documented on purpose)

- **Notification delivery.** Expiry reminders are *queued* in
  `notification_outbox`, and push subscriptions are stored. A sender (email via
  Resend/Postmark, or web push with a VAPID private key) still needs to be
  added as a scheduled edge function. The service worker already handles
  `push` and `notificationclick`.
- **Workshop ticket sales.** `is_special` classes are blocked for memberships;
  selling tickets for them would be a separate product.
- **Studio details.** Fill in `src/config/studio.ts` (address, email, phone, Instagram).
