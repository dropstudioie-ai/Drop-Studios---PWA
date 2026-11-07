# Deploying Drop Studios

## 1. Supabase project

1. Create a project at supabase.com (region: `eu-west-1` Ireland is closest).
2. Link and push the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   This applies `supabase/migrations/*`, including the five membership plans,
   the dance styles and the weekly timetable. It does **not** run
   `supabase/seed.sql` (local-only test data).
3. Scheduled jobs: the migrations enable **pg_cron** (available on hosted
   Supabase) and schedule:
   - `drop-generate-sessions`: daily, publishes 5 weeks of classes from the weekly timetable.
   - `drop-expiry-reminders`: daily, queues reminders (when enabled in Admin → Settings).
   - `drop-release-holds`: every 10 minutes, frees workshop spots whose checkout was never paid.
   Check them under Database → Cron after pushing.
4. Auth settings: set **Site URL** to your domain and add
   `https://<domain>/reset-password` to the redirect URLs. Keep email
   confirmations on in production. Configure custom SMTP for branded emails.

> **Production status (7 Nov 2026):** all migrations up to
> `20261105000002_square_checkout.sql` were applied to the live project through
> the Supabase Management API. Supabase recorded them under that day's
> timestamps (same names, different version numbers). Before using
> `supabase db push` from the CLI for the first time, align the history with
> `npx supabase migration list` and `npx supabase migration repair`.

## 2. First admin

Register through the app, then in the SQL editor:
```sql
update public.profiles set role = 'admin' where email = 'you@dropstudios.ie';
```
Further admins can be promoted from Admin → Customers.

## 3. Check the timetable

`db push` installs the confirmed weekly timetable (migration
`20261030000003_drop_timetable.sql`): 11 classes in the Ground Floor Studio,
30 spots each, with their instructors. Monday Heels ends on 14 December 2026.
Private sessions and room rentals are not part of the app. After any change in
Admin → Timetable, press **Publish next 5 weeks**.

## 4. Square (real payments)

Online payments use **Square**, the same account as the studio's card reader, so
online and in-studio sales share one dashboard and payout. Test in Square's
**sandbox** first.

1. At developer.squareup.com sign in with the studio's Square account and create
   an application (e.g. "Drop Studios app").
2. Under **Credentials** copy the access token (Sandbox while testing, Production
   when live). Under **Locations** copy the location ID of the studio.
3. Under **Webhooks → Subscriptions** add an endpoint
   `https://<project-ref>.supabase.co/functions/v1/square-webhook` for events
   `payment.created`, `payment.updated`, `refund.created`, `refund.updated`, and
   copy its **signature key**.
4. Save them as Supabase secrets (never in Vercel or the frontend):
   ```bash
   npx supabase secrets set SQUARE_ENVIRONMENT=sandbox SQUARE_ACCESS_TOKEN=... \
     SQUARE_LOCATION_ID=... SQUARE_WEBHOOK_SIGNATURE_KEY=... \
     SQUARE_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/square-webhook \
     SITE_URL=https://www.dropstudios.ie ALLOWED_ORIGINS=https://www.dropstudios.ie,https://drop-studios-pwa.vercel.app \
     SUPPORT_EMAIL=dropstudioie@gmail.com
   ```
   `SQUARE_WEBHOOK_URL` must match the URL registered in step 3 exactly, or every
   notification is rejected.
5. Deploy the functions:
   ```bash
   npx supabase functions deploy create-checkout
   npx supabase functions deploy square-webhook --no-verify-jwt
   ```
   Do **not** deploy `dev-checkout` to production (it also refuses to run when
   `SQUARE_ENVIRONMENT=production` or without `ALLOW_TEST_PAYMENTS=true`).
6. Buy the Intro Offer in the app and pay with a Square sandbox test card. The
   membership should appear in My Membership within seconds.
7. To go live, repeat steps 2–4 with the **Production** token, location ID and a
   production webhook subscription, and set `SQUARE_ENVIRONMENT=production`.

How it works: the app creates a Square payment link priced from the database;
Square's signed `payment.*` webhook activates the membership once the payment is
`COMPLETED`. Square sends webhooks for every payment on the account, including
card-reader sales; those are ignored. Tipping is turned off on app checkouts.

Refunds: issue them in the Square Dashboard. Each refund is written to the audit
log; a full refund also marks the payment `refunded`. Whether to remove any
remaining classes is a studio decision: Admin → Customers → *Grant / revoke
classes* with a reason.

### Workshop tickets

In Admin → Timetable, tick **Special event** on a recurring or one-off class and
enter a **Ticket price**. Customers then see *Buy ticket* instead of booking with
a membership. Starting checkout holds their spot for about 30 minutes; the
webhook confirms it, and a cron job releases unpaid holds after about 35 minutes. Paid tickets can’t be cancelled in the
app. Refunds are issued by the studio in Square. If a payment ever arrives after
its spot was lost, or the studio cancels the event, the Admin overview shows
“tickets need a refund” and the audit log lists them as `ticket_refund_required`.

## 5. Frontend hosting (Vercel, Netlify or Cloudflare Pages)

Build command `npm run build`, output `dist`. Environment variables:

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the project’s anon/public key |
| `VITE_PAYMENTS_MODE` | `live` |
| `VITE_VAPID_PUBLIC_KEY` | optional, for push |

`vercel.json` in the repository sets this up on Vercel: every app link (such as
`/terms` or `/timetable`) falls back to `index.html`, `sw.js` is served with
`Cache-Control: no-cache` so updates roll out, and basic security headers are
added. On Netlify, add `/* /index.html 200` to a `_redirects` file instead. HTTPS is
required for the service worker and install prompts.

## 6. Local development

```bash
npm install
npx supabase start            # needs Docker
npx supabase db reset         # applies migrations (incl. the real timetable)
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

## 7. Notifications (expiry reminders, class cancellations)

Messages are queued in `notification_outbox` (expiry reminders when enabled in
Admin → Settings; a message to each booked customer when the studio cancels a
class) and delivered by the `send-notifications` edge function. Email and push
are independent; configure one or both.

1. **Email** via [Resend](https://resend.com): verify your sending domain, then
   `npx supabase secrets set RESEND_API_KEY=re_... EMAIL_FROM="Drop Studios <hello@dropstudios.ie>"`
2. **Web push** (optional): `npx web-push generate-vapid-keys`, then
   `npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:hello@dropstudios.ie`
   and set the same public key as `VITE_VAPID_PUBLIC_KEY` in the frontend. Customers
   enable it with *Enable notifications* in My Membership.
3. Protect and deploy the sender:
   ```bash
   npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
   npx supabase functions deploy send-notifications --no-verify-jwt
   ```
4. Schedule it every 5 minutes (SQL editor; enable the `pg_net` extension first).
   Store the secret in Vault rather than in the job text:
   ```sql
   select vault.create_secret('<the CRON_SECRET value>', 'cron_secret');
   select cron.schedule('drop-send-notifications', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/send-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
       )
     )
   $$);
   ```

Failed deliveries are retried up to 5 times; the last error is kept on the
outbox row. Messages for customers with neither an email nor a push
subscription are marked done.

## 8. Still to do

- **Studio details.** Fill in `src/config/studio.ts` (address, email, phone, Instagram).
- **Legal pages.** `/terms` and `/privacy` are drafts written to match how the app works.
  Have a solicitor review them before launch, add your registered business name
  (`legalName` in `src/config/studio.ts`), keep `DATA_PROCESSORS` in line with the
  services you actually use, and update `POLICIES_UPDATED` whenever the text changes.
  Account deletion requests are handled by email for now.
- **Home-page wording.** The headline and intro text are placeholders; replace them with your own.
- **Live verification.** Run a Square sandbox payment (membership and ticket) and a
  reminder email end-to-end against your Supabase project before launch.
