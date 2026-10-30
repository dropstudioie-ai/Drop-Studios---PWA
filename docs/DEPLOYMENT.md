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

### Workshop tickets

In Admin → Timetable, tick **Special event** on a recurring or one-off class and
enter a **Ticket price**. Customers then see *Buy ticket* instead of booking with
a membership. Starting checkout holds their spot for about 30 minutes; the
webhook confirms it, and an expired checkout releases it (a cron job also
clears stale holds every 10 minutes). Paid tickets can’t be cancelled in the
app. Refunds are issued by the studio in Stripe. If a payment ever arrives after
its spot was lost, or the studio cancels the event, the Admin overview shows
“tickets need a refund” and the audit log lists them as `ticket_refund_required`.

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
- **Home-page wording.** The headline and intro text are placeholders; replace them with your own.
- **Live verification.** Run a Stripe test-mode payment (membership and ticket) and a
  reminder email end-to-end against your Supabase project before launch.
