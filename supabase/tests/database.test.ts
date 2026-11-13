import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ADMIN_URL, anon, as, createTestDatabase, createUser, expectError, service, user } from './harness';

const run = ADMIN_URL ? describe : describe.skip;

run('database: plans, booking, allowances, pauses, security', () => {
  let ctx: Awaited<ReturnType<typeof createTestDatabase>>;
  let db: pg.Client;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestDatabase();
    db = ctx.db;
    admin = await createUser(db, 'Admin', 'admin');
  }, 60_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  const styleId = async (slug: string) =>
    (await db.query(`select id from dance_styles where slug = $1`, [slug])).rows[0].id as string;
  const planId = async (code: string) =>
    (await db.query(`select id from membership_plans where code = $1`, [code])).rows[0].id as string;

  async function makeSession(opts: {
    style: string;
    startsInMinutes: number;
    capacity?: number;
    isSpecial?: boolean;
    templateId?: string;
  }) {
    const { rows } = await db.query(
      `insert into class_sessions (title, style_id, starts_at, ends_at, capacity, is_special, template_id)
       values ($1, $2, now() + make_interval(mins => $3), now() + make_interval(mins => $3 + 60), $4, $5, $6)
       returning id`,
      [`${opts.style} class`, await styleId(opts.style), opts.startsInMinutes, opts.capacity ?? 20, opts.isSpecial ?? false, opts.templateId ?? null],
    );
    return rows[0].id as string;
  }

  async function buy(uid: string, code: string, style?: string, provider: 'square' | 'dev_test' = 'square') {
    const [checkout] = await as<{ r: { payment_id: string; amount_cents: number; currency: string } }>(
      db,
      user(uid),
      `select create_checkout($1, $2, $3, $4) as r`,
      [await planId(code), style ? await styleId(style) : null, randomUUID(), provider],
    );
    const { payment_id, amount_cents, currency } = checkout.r;
    const [res] = await as<{ r: { ok: boolean; membership_id: string } }>(
      db,
      service,
      `select fulfill_payment($1, $2, $3, $4, $5, $6) as r`,
      [payment_id, provider, `pi_${randomUUID()}`, `evt_${randomUUID()}`, amount_cents, currency],
    );
    expect(res.r.ok).toBe(true);
    return { paymentId: payment_id, membershipId: res.r.membership_id };
  }

  const book = async (uid: string, sessionId: string, membershipId?: string) =>
    (await as<{ r: { booking_id: string; classes_remaining: number } }>(db, user(uid), `select book_class($1, $2) as r`, [sessionId, membershipId ?? null]))[0].r;

  const remaining = async (membershipId: string) =>
    (await db.query(`select classes_remaining from memberships where id = $1`, [membershipId])).rows[0].classes_remaining as number;

  // ---------------------------------------------------------------- plans
  describe('membership plans', () => {
    it('seeds the five plans with exact prices, classes, validity and access', async () => {
      const rows = await as<Record<string, unknown>>(
        db,
        anon,
        `select code, name, display_label, price_cents, currency, class_count, validity_days, style_access, first_time_only,
                billing_interval, commitment_months, credit_rollover, highlight
         from membership_plans order by sort_order`,
      );
      expect(rows).toEqual([
        { code: 'intro-3', name: '3-Class Intro Offer', display_label: 'Intro Offer', price_cents: 3500, currency: 'EUR', class_count: 3, validity_days: 21, style_access: 'multi', first_time_only: true, billing_interval: 'one_off', commitment_months: null, credit_rollover: false, highlight: null },
        { code: 'single-4', name: 'Single Style', display_label: null, price_cents: 4900, currency: 'EUR', class_count: 4, validity_days: 30, style_access: 'single', first_time_only: false, billing_interval: 'monthly', commitment_months: 3, credit_rollover: false, highlight: null },
        { code: 'multi-5', name: 'Multi-Style', display_label: null, price_cents: 5500, currency: 'EUR', class_count: 5, validity_days: 30, style_access: 'multi', first_time_only: false, billing_interval: 'monthly', commitment_months: 3, credit_rollover: false, highlight: null },
        { code: 'multi-8', name: 'Committed', display_label: 'Great for your weekly routine', price_cents: 7900, currency: 'EUR', class_count: 8, validity_days: 30, style_access: 'multi', first_time_only: false, billing_interval: 'monthly', commitment_months: 3, credit_rollover: false, highlight: 'recommended' },
        { code: 'multi-12', name: 'All In', display_label: 'Best value', price_cents: 9900, currency: 'EUR', class_count: 12, validity_days: 30, style_access: 'multi', first_time_only: false, billing_interval: 'monthly', commitment_months: 3, credit_rollover: true, highlight: 'best_value' },
      ]);
    });

    it('no plan is labelled most popular unless an admin enables it', async () => {
      const { rows } = await db.query(`select count(*)::int as n from membership_plans where is_most_popular`);
      expect(rows[0].n).toBe(0);
    });

    it('customers cannot edit plans; admins can, and edits are audited', async () => {
      const c = await createUser(db, 'PlanEditor');
      const updated = await as(db, user(c), `update membership_plans set price_cents = 1 where code = 'multi-5' returning id`);
      expect(updated).toHaveLength(0);
      await as(db, user(admin), `update membership_plans set is_most_popular = true where code = 'multi-8'`);
      const audit = await as<{ n: number }>(db, user(admin), `select count(*)::int as n from audit_log where entity_type = 'membership_plans'`);
      expect(audit[0].n).toBeGreaterThan(0);
      await as(db, user(admin), `update membership_plans set is_most_popular = false where code = 'multi-8'`);
    });
  });

  // ---------------------------------------------------------------- timetable
  describe('studio timetable', () => {
    it('installs the confirmed weekly timetable: one studio, 30 spots, named instructors', async () => {
      const { rows } = await db.query(
        `select t.weekday, to_char(t.start_time, 'HH24:MI') as at, t.title, s.name as style, t.room, i.full_name as instructor, t.capacity
         from class_templates t join dance_styles s on s.id = t.style_id left join instructors i on i.id = t.instructor_id
         where t.valid_from = '2026-10-26' order by t.weekday, t.start_time`,
      );
      expect(rows.map((r) => `${r.weekday} ${r.at} ${r.title} (${r.style}, ${r.room}, ${r.instructor}, ${r.capacity})`)).toEqual([
        '1 18:00 Choreography (Choreography, Ground Floor Studio, Vini Martins, 30)',
        '1 19:00 Jazz Funk (Jazz Funk, Ground Floor Studio, Vini Martins, 30)',
        '1 20:00 Heels (Heels, Ground Floor Studio, Talita Lima, 30)',
        '2 18:30 FitDance (FitDance, Ground Floor Studio, João Zublin, 30)',
        '2 19:30 Reggaeton (Reggaeton, Ground Floor Studio, Humberto, 30)',
        '3 18:30 FitDance (FitDance, Ground Floor Studio, Jorginho, 30)',
        '3 19:30 Hip Hop (Hip Hop, Ground Floor Studio, Ana Souto, 30)',
        '4 18:30 FitDance (FitDance, Ground Floor Studio, João Zublin, 30)',
        '4 19:30 Commercial (Commercial, Ground Floor Studio, Alex Oliveira, 30)',
        '6 12:30 FitDance (FitDance, Ground Floor Studio, João Zublin, 30)',
        '6 13:30 Commercial (Commercial, Ground Floor Studio, Alex Oliveira, 30)',
      ]);
    });

    it('has no overlapping classes in the single studio', async () => {
      const { rows } = await db.query(
        `select a.title || ' / ' || b.title as clash from class_templates a join class_templates b
           on a.id < b.id and a.weekday = b.weekday and a.valid_from = '2026-10-26' and b.valid_from = '2026-10-26'
          and a.start_time < b.start_time + make_interval(mins => b.duration_minutes)
          and b.start_time < a.start_time + make_interval(mins => a.duration_minutes)`,
      );
      expect(rows).toEqual([]);
    });

    it('publishes classes in Dublin time and stops Heels after 14 December', async () => {
      await db.query(`select generate_sessions('2026-12-07', '2026-12-27')`);
      const { rows } = await db.query(
        `select to_char(starts_at at time zone 'Europe/Dublin', 'YYYY-MM-DD HH24:MI') as local
         from class_sessions where title = 'Heels' and template_id is not null and starts_at >= '2026-12-07' order by starts_at`,
      );
      expect(rows.map((r) => r.local)).toEqual(['2026-12-07 20:00', '2026-12-14 20:00']);
    });
  });

  // ---------------------------------------------------------------- purchases
  describe('purchases and payments', () => {
    it('takes the price from the database and snapshots plan terms', async () => {
      const c = await createUser(db, 'Buyer');
      const { paymentId, membershipId } = await buy(c, 'multi-5');
      const [p] = (await db.query(`select amount_cents, status from payments where id = $1`, [paymentId])).rows;
      expect(p).toEqual({ amount_cents: 5500, status: 'succeeded' });
      const [m] = (await db.query(
        `select m.classes_total, m.classes_remaining, pu.price_cents, pu.validity_days, pu.class_count
         from memberships m join membership_purchases pu on pu.id = m.purchase_id where m.id = $1`,
        [membershipId],
      )).rows;
      expect(m.classes_total).toBe(5);
      expect(m).toMatchObject({ classes_remaining: 5, price_cents: 5500, class_count: 5 });
      expect(m.validity_days).toBeGreaterThanOrEqual(28); // one billing month
    });

    it('fulfilment is idempotent: repeated webhooks grant classes once', async () => {
      const c = await createUser(db, 'DoubleWebhook');
      const [checkout] = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [await planId('multi-8'), randomUUID()]);
      const call = () =>
        as<{ r: { membership_id: string; duplicate: boolean } }>(db, service, `select fulfill_payment($1, 'square', 'pi_x', $2, 7900, 'eur') as r`, [checkout.r.payment_id, `evt_${randomUUID()}`]);
      const first = (await call())[0].r;
      const second = (await call())[0].r;
      expect(second.duplicate).toBe(true);
      expect(second.membership_id).toBe(first.membership_id);
      const { rows } = await db.query(`select count(*)::int n from credit_transactions where user_id = $1 and kind = 'grant_purchase'`, [c]);
      expect(rows[0].n).toBe(1);
    });

    it('same idempotency key returns the same pending payment', async () => {
      const c = await createUser(db, 'IdemKey');
      const key = randomUUID();
      const pid = await planId('multi-5');
      const a = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [pid, key]);
      const b = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [pid, key]);
      expect(a[0].r.payment_id).toBe(b[0].r.payment_id);
    });

    it('rejects payments whose amount does not match', async () => {
      const c = await createUser(db, 'Mismatch');
      const [checkout] = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [await planId('multi-12'), randomUUID()]);
      const [res] = await as<{ r: { ok: boolean; error: string } }>(db, service, `select fulfill_payment($1, 'square', 'pi', 'evt_mm', 100, 'EUR') as r`, [checkout.r.payment_id]);
      expect(res.r).toEqual({ ok: false, error: 'amount_mismatch' });
      const { rows } = await db.query(`select count(*)::int n from memberships where user_id = $1`, [c]);
      expect(rows[0].n).toBe(0);
    });

    it('customers cannot fulfil payments or write memberships directly', async () => {
      const c = await createUser(db, 'Sneaky');
      const [checkout] = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [await planId('multi-12'), randomUUID()]);
      await expect(as(db, user(c), `select fulfill_payment($1, 'square', 'x', 'y', 9900, 'EUR')`, [checkout.r.payment_id])).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `update memberships set classes_remaining = 99`)).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `update profiles set role = 'admin' where id = $1`, [c])).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `insert into bookings (user_id, session_id) values ($1, $1)`, [c])).rejects.toThrow(/permission denied/);
    });

    it('a new checkout replaces an unfinished one instead of blocking it', async () => {
      const c = await createUser(db, 'ComesBack');
      const start = async (code: string) => (await as<{ r: { payment_id: string; superseded: { plan_name: string }[] } }>(db, user(c),
        `select create_checkout($1, null, $2, 'square') as r`, [await planId(code), randomUUID()]))[0].r;
      const first = await start('intro-3');
      expect(first.superseded).toEqual([]);
      const second = await start('intro-3'); // left Square without paying, then came back
      expect(second.superseded.map((x) => x.plan_name)).toEqual(['3-Class Intro Offer']);
      const status = async (id: string) => (await db.query(`select status, failure_reason, review_reason from payments where id = $1`, [id])).rows[0];
      expect(await status(first.payment_id)).toMatchObject({ status: 'cancelled', failure_reason: 'replaced by a new checkout' });
      expect((await status(second.payment_id)).status).toBe('pending');
      // Choosing a different plan also replaces the unfinished intro.
      const third = await start('multi-5');
      expect(third.superseded.map((x) => x.plan_name)).toEqual(['3-Class Intro Offer']);

      // If the replaced checkout is paid anyway (an old tab), it's honoured and flagged for the studio.
      const [res] = await as<{ r: { ok: boolean; membership_id: string } }>(db, service,
        `select fulfill_payment($1, 'square', 'pay_old', $2, 3500, 'EUR') as r`, [first.payment_id, `evt_${randomUUID()}`]);
      expect(res.r.ok).toBe(true);
      expect(await status(first.payment_id)).toMatchObject({ status: 'succeeded', review_reason: 'paid_after_cancel' });
      expect((await db.query(`select count(*)::int n from notification_outbox where kind = 'payment_review' and user_id = $1`, [admin])).rows[0].n).toBeGreaterThanOrEqual(1);
      await expectError(as(db, user(c), `select admin_resolve_payment_review($1, 'refunded')`, [first.payment_id]), 'forbidden');
      await as(db, user(admin), `select admin_resolve_payment_review($1, 'Refunded the second intro in Square')`, [first.payment_id]);
      expect((await status(first.payment_id)).review_reason).toBeNull();

      // The studio can cancel an unfinished checkout; the member can't use the admin function.
      await expectError(as(db, user(c), `select admin_cancel_checkout($1)`, [third.payment_id]), 'forbidden');
      await as(db, user(admin), `select admin_cancel_checkout($1)`, [third.payment_id]);
      expect((await status(third.payment_id)).status).toBe('cancelled');
      await expectError(as(db, user(admin), `select admin_cancel_checkout($1)`, [third.payment_id]), 'payment_not_pending');
    });

    it('intro offer is limited to first-time customers', async () => {
      const c = await createUser(db, 'IntroTwice');
      await buy(c, 'intro-3');
      await expectError(as(db, user(c), `select create_checkout($1, null, $2)`, [await planId('intro-3'), randomUUID()]), 'intro_not_eligible');
    });

    it('single-style plan requires an eligible style', async () => {
      const c = await createUser(db, 'NoStyle');
      await expectError(as(db, user(c), `select create_checkout($1, null, $2)`, [await planId('single-4'), randomUUID()]), 'style_required');
    });

    it('price changes do not alter memberships already purchased', async () => {
      const c = await createUser(db, 'PriceLock');
      const { membershipId } = await buy(c, 'multi-5');
      await db.query(`update membership_plans set price_cents = 6000, class_count = 4 where code = 'multi-5'`);
      const [m] = (await db.query(
        `select pu.price_cents, pu.class_count, m.classes_total from memberships m join membership_purchases pu on pu.id = m.purchase_id where m.id = $1`,
        [membershipId],
      )).rows;
      expect(m).toEqual({ price_cents: 5500, class_count: 5, classes_total: 5 });
      await db.query(`update membership_plans set price_cents = 5500, class_count = 5 where code = 'multi-5'`);
      await expect(db.query(`update membership_purchases set price_cents = 1`)).rejects.toThrow(/immutable_record/);
    });

    it('a pending Square Sandbox payment can be flagged as a test, never the other way', async () => {
      const c = await createUser(db, 'SandboxBuyer');
      const [checkout] = await as<{ r: { payment_id: string; amount_cents: number } }>(db, user(c),
        `select create_checkout($1, null, $2, 'square') as r`, [await planId('multi-5'), randomUUID()]);
      const id = checkout.r.payment_id;
      await as(db, service, `update payments set is_test = true, provider_session_id = 'order_1' where id = $1`, [id]);
      await expect(as(db, service, `update payments set is_test = false where id = $1`, [id])).rejects.toThrow(/immutable_record/);
      const [res] = await as<{ r: { membership_id: string } }>(db, service,
        `select fulfill_payment($1, 'square', 'pay_1', $2, $3, 'EUR') as r`, [id, `evt_${randomUUID()}`, checkout.r.amount_cents]);
      expect((await db.query(`select is_test from memberships where id = $1`, [res.r.membership_id])).rows[0].is_test).toBe(true);
      const real = await buy(await createUser(db, 'RealBuyer'), 'multi-5');
      await expect(db.query(`update payments set is_test = true where id = $1`, [real.paymentId])).rejects.toThrow(/immutable_record/);
    });
  });

  // ---------------------------------------------------------------- RLS
  describe('row level security', () => {
    it('customers only see their own memberships and bookings; anon sees none', async () => {
      const a = await createUser(db, 'Alice');
      const b = await createUser(db, 'Bob');
      const { membershipId } = await buy(a, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 24 * 60 });
      await book(a, s);

      expect(await as(db, user(b), `select * from memberships where id = $1`, [membershipId])).toHaveLength(0);
      expect(await as(db, user(b), `select * from bookings where user_id = $1`, [a])).toHaveLength(0);
      expect(await as(db, user(b), `select * from profiles where id = $1`, [a])).toHaveLength(0);
      expect(await as(db, user(a), `select * from memberships where id = $1`, [membershipId])).toHaveLength(1);
      await expect(as(db, anon, `select * from memberships`)).rejects.toThrow(/permission denied/);
      expect(await as(db, user(admin), `select * from memberships where id = $1`, [membershipId])).toHaveLength(1);
    });

    it('admin functions refuse non-admins', async () => {
      const c = await createUser(db, 'NotAdmin');
      const { membershipId } = await buy(c, 'multi-5');
      await expectError(as(db, user(c), `select admin_adjust_classes($1, 5, 'gift')`, [membershipId]), 'forbidden');
      await expectError(as(db, user(c), `select admin_analytics(current_date - 30, current_date)`), 'forbidden');
      await expectError(as(db, user(c), `select admin_set_role($1, 'admin')`, [c]), 'forbidden');
    });
  });

  // ---------------------------------------------------------------- booking
  describe('booking and cancellation', () => {
    it('booking consumes one class and blocks double booking', async () => {
      const c = await createUser(db, 'Booker');
      const { membershipId } = await buy(c, 'multi-5');
      const s = await makeSession({ style: 'hip-hop', startsInMinutes: 3 * 24 * 60 });
      const r = await book(c, s);
      expect(r.classes_remaining).toBe(4);
      await expectError(book(c, s), 'already_booked');
      expect(await remaining(membershipId)).toBe(4);
      const { rows } = await db.query(`select booked_count from class_sessions where id = $1`, [s]);
      expect(rows[0].booked_count).toBe(1);
    });

    it('enforces the 3-week booking window', async () => {
      const c = await createUser(db, 'TooEarly');
      await buy(c, 'multi-12');
      const far = await makeSession({ style: 'jazz-funk', startsInMinutes: 22 * 24 * 60 });
      await expectError(book(c, far), 'outside_booking_window');
      const ok = await makeSession({ style: 'jazz-funk', startsInMinutes: 20 * 24 * 60 });
      await book(c, ok);
    });

    it('cancelling 30+ minutes before restores the class', async () => {
      const c = await createUser(db, 'OnTimeCancel');
      const { membershipId } = await buy(c, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 31 });
      const { booking_id } = await book(c, s);
      const [res] = await as<{ r: { status: string; class_restored: boolean } }>(db, user(c), `select cancel_booking($1) as r`, [booking_id]);
      expect(res.r).toMatchObject({ status: 'cancelled', class_restored: true });
      expect(await remaining(membershipId)).toBe(5);
      // can rebook after cancelling
      await book(c, s);
    });

    it('late cancellation (under 30 minutes) does not restore the class', async () => {
      const c = await createUser(db, 'LateCancel');
      const { membershipId } = await buy(c, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 20 });
      const { booking_id } = await book(c, s);
      const [res] = await as<{ r: { status: string; class_restored: boolean } }>(db, user(c), `select cancel_booking($1) as r`, [booking_id]);
      expect(res.r).toMatchObject({ status: 'late_cancelled', class_restored: false });
      expect(await remaining(membershipId)).toBe(4);
      const { rows } = await db.query(`select booked_count from class_sessions where id = $1`, [s]);
      expect(rows[0].booked_count).toBe(0);
    });

    it('customers cannot cancel other people’s bookings', async () => {
      const a = await createUser(db, 'Owner');
      const b = await createUser(db, 'Other');
      await buy(a, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 600 });
      const { booking_id } = await book(a, s);
      await expectError(as(db, user(b), `select cancel_booking($1)`, [booking_id]), 'booking_not_found');
    });

    it('cannot book without classes remaining', async () => {
      const c = await createUser(db, 'UsedUp');
      await buy(c, 'intro-3');
      for (let i = 0; i < 3; i++) await book(c, await makeSession({ style: 'commercial', startsInMinutes: 600 + i }));
      await expectError(book(c, await makeSession({ style: 'commercial', startsInMinutes: 700 })), 'no_classes_left');
    });

    it('expired memberships cannot be used', async () => {
      const c = await createUser(db, 'Expired');
      const { membershipId } = await buy(c, 'multi-5');
      await db.query(`update memberships set expires_at = now() - interval '1 minute' where id = $1`, [membershipId]);
      await expectError(book(c, await makeSession({ style: 'heels', startsInMinutes: 600 })), 'membership_expired');
      const [st] = await as<{ state: string }>(db, user(c), `select state(m) as state from memberships m where id = $1`, [membershipId]);
      expect(st.state).toBe('expired');
    });

    it('cannot book a class that starts after the membership expires', async () => {
      const c = await createUser(db, 'AfterExpiry');
      const { membershipId } = await buy(c, 'intro-3');
      await db.query(`update memberships set expires_at = now() + interval '2 days' where id = $1`, [membershipId]);
      await expectError(book(c, await makeSession({ style: 'heels', startsInMinutes: 4 * 24 * 60 })), 'class_after_expiry');
    });

    it('prevents overspending under concurrent booking requests', async () => {
      const c = await createUser(db, 'Racer');
      const { membershipId } = await buy(c, 'intro-3');
      await db.query(`update memberships set classes_remaining = 1 where id = $1`, [membershipId]);
      const sessions = await Promise.all(
        Array.from({ length: 6 }, (_, i) => makeSession({ style: 'reggaeton', startsInMinutes: 900 + i })),
      );
      const clients = await Promise.all(sessions.map(async () => {
        const cl = new pg.Client({ connectionString: ctx.connectionString });
        await cl.connect();
        return cl;
      }));
      const results = await Promise.allSettled(
        sessions.map((s, i) => as(clients[i], user(c), `select book_class($1) as r`, [s])),
      );
      await Promise.all(clients.map((cl) => cl.end()));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await remaining(membershipId)).toBe(0);
      const { rows } = await db.query(`select count(*)::int n from bookings where membership_id = $1 and status = 'booked'`, [membershipId]);
      expect(rows[0].n).toBe(1);
    });

    it('never overfills a class under concurrent requests', async () => {
      const s = await makeSession({ style: 'fitdance', startsInMinutes: 1200, capacity: 2 });
      const users = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(db, `Crowd${i}`)));
      for (const u of users) await buy(u, 'multi-5');
      const clients = await Promise.all(users.map(async () => {
        const cl = new pg.Client({ connectionString: ctx.connectionString });
        await cl.connect();
        return cl;
      }));
      const results = await Promise.allSettled(users.map((u, i) => as(clients[i], user(u), `select book_class($1)`, [s])));
      await Promise.all(clients.map((cl) => cl.end()));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const { rows } = await db.query(`select booked_count from class_sessions where id = $1`, [s]);
      expect(rows[0].booked_count).toBe(2);
    });
  });

  // ---------------------------------------------------------------- eligibility
  describe('style and class eligibility', () => {
    it('single-style plan only books the chosen style', async () => {
      const c = await createUser(db, 'SingleStyle');
      await buy(c, 'single-4', 'heels');
      await book(c, await makeSession({ style: 'heels', startsInMinutes: 800 }));
      await expectError(book(c, await makeSession({ style: 'hip-hop', startsInMinutes: 800 })), 'style_not_included');
    });

    it('multi-style plans book across all eligible styles', async () => {
      const c = await createUser(db, 'MultiStyle');
      await buy(c, 'multi-8');
      for (const s of ['heels', 'hip-hop', 'commercial', 'jazz-funk', 'reggaeton', 'fitdance']) {
        await book(c, await makeSession({ style: s, startsInMinutes: 900 }));
      }
    });

    it('excluded classes and special events are refused with alternatives offered', async () => {
      const c = await createUser(db, 'Excluded');
      await buy(c, 'multi-5');
      const pid = await planId('multi-5');
      const excluded = await makeSession({ style: 'heels', startsInMinutes: 1000 });
      await db.query(`insert into plan_exclusions (plan_id, session_id, reason) values ($1, $2, 'Masterclass')`, [pid, excluded]);
      await expectError(book(c, excluded), 'class_excluded');

      const workshop = await makeSession({ style: 'heels', startsInMinutes: 1000, isSpecial: true });
      await expectError(book(c, workshop), 'special_event');

      const alt = await makeSession({ style: 'heels', startsInMinutes: 1100 });
      const [opt] = await as<{ r: { eligible_membership_id: string | null; memberships: { issue: string }[]; alternatives: { id: string }[] } }>(
        db, user(c), `select booking_options($1) as r`, [excluded],
      );
      expect(opt.r.eligible_membership_id).toBeNull();
      expect(opt.r.memberships[0].issue).toBe('class_excluded');
      expect(opt.r.alternatives.map((a) => a.id)).toContain(alt);
    });

    it('recurring-class exclusions added after purchase do not change existing terms', async () => {
      const c = await createUser(db, 'Grandfathered');
      const { rows: [t] } = await db.query(
        `insert into class_templates (title, style_id, weekday, start_time) values ('Heels Tue', $1, 2, '19:00') returning id`,
        [await styleId('heels')],
      );
      await buy(c, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 1300, templateId: t.id });
      await db.query(`insert into plan_exclusions (plan_id, template_id) values ($1, $2)`, [await planId('multi-5'), t.id]);
      await book(c, s); // purchased before the exclusion existed

      const newbie = await createUser(db, 'AfterExclusion');
      await buy(newbie, 'multi-5');
      await expectError(book(newbie, s), 'class_excluded');
    });
  });

  // ---------------------------------------------------------------- lifecycle
  describe('activation, expiry and pauses', () => {
    it('expiry = end of local day (activation + validity days)', async () => {
      const c = await createUser(db, 'ExpiryCalc');
      const { membershipId } = await buy(c, 'intro-3');
      const [m] = (await db.query(
        `select (activated_at at time zone 'Europe/Dublin')::date as act,
                (expires_at at time zone 'Europe/Dublin') as exp
         from memberships where id = $1`, [membershipId],
      )).rows;
      const act = new Date(m.act);
      const exp = new Date(m.exp);
      expect(Math.round((exp.getTime() - act.getTime()) / 86_400_000)).toBe(22); // midnight after day 21 (one-off Intro Offer)
      expect(exp.getHours()).toBe(0);
    });

    it('activation on first booking when configured', async () => {
      await db.query(`update app_settings set activation_policy = 'on_first_booking'`);
      try {
        const c = await createUser(db, 'LateActivation');
        const { membershipId } = await buy(c, 'intro-3');
        let [m] = (await db.query(`select activated_at, expires_at from memberships where id = $1`, [membershipId])).rows;
        expect(m.activated_at).toBeNull();
        const [st] = await as<{ s: string }>(db, user(c), `select state(m) s from memberships m where id = $1`, [membershipId]);
        expect(st.s).toBe('pending_activation');
        await book(c, await makeSession({ style: 'heels', startsInMinutes: 300 }));
        [m] = (await db.query(`select activated_at, expires_at from memberships where id = $1`, [membershipId])).rows;
        expect(m.activated_at).not.toBeNull();
        expect(m.expires_at).not.toBeNull();
      } finally {
        await db.query(`update app_settings set activation_policy = 'on_purchase'`);
      }
    });

    it('pausing extends expiry by the paused days and blocks bookings in the pause', async () => {
      const c = await createUser(db, 'Pauser');
      const { membershipId } = await buy(c, 'intro-3');
      const before = (await db.query(`select expires_at from memberships where id = $1`, [membershipId])).rows[0].expires_at as Date;
      await as(db, user(c), `select pause_membership($1, current_date + 2, current_date + 15)`, [membershipId]);
      const after = (await db.query(`select expires_at from memberships where id = $1`, [membershipId])).rows[0].expires_at as Date;
      expect(Math.round((after.getTime() - before.getTime()) / 86_400_000)).toBe(14);

      const inPause = await makeSession({ style: 'heels', startsInMinutes: 5 * 24 * 60 });
      await expectError(book(c, inPause), 'class_in_pause');

      // resuming before it starts removes it and restores the original expiry
      await as(db, user(c), `select resume_membership($1)`, [membershipId]);
      const resumed = (await db.query(`select expires_at from memberships where id = $1`, [membershipId])).rows[0].expires_at as Date;
      expect(resumed.getTime()).toBe(before.getTime());
      await book(c, inPause);
    });

    it('a currently paused membership cannot book anything', async () => {
      const c = await createUser(db, 'PausedNow');
      const { membershipId } = await buy(c, 'intro-3');
      await as(db, user(c), `select pause_membership($1, current_date, current_date + 10)`, [membershipId]);
      const [st] = await as<{ s: string }>(db, user(c), `select state(m) s from memberships m where id = $1`, [membershipId]);
      expect(st.s).toBe('paused');
      await expectError(book(c, await makeSession({ style: 'heels', startsInMinutes: 12 * 24 * 60 })), 'membership_paused');
    });

    it('limits pauses to 90 days per calendar year', async () => {
      const c = await createUser(db, 'LongPause');
      const { membershipId } = await buy(c, 'intro-3');
      await expectError(
        as(db, user(c), `select pause_membership($1, current_date + 1, current_date + 91)`, [membershipId]),
        'pause_limit_exceeded',
      );
      await expectError(
        as(db, user(c), `select pause_membership($1, current_date + 1, current_date + 2)`, [membershipId]),
        'pause_too_short',
      );
    });

    it('refuses a pause that overlaps existing bookings', async () => {
      const c = await createUser(db, 'BookedPause');
      const { membershipId } = await buy(c, 'intro-3');
      await book(c, await makeSession({ style: 'heels', startsInMinutes: 3 * 24 * 60 }));
      await expectError(
        as(db, user(c), `select pause_membership($1, current_date + 1, current_date + 10)`, [membershipId]),
        'bookings_during_pause',
      );
    });

    it('admins can pause past the limits and resume, all audited', async () => {
      const c = await createUser(db, 'AdminPaused');
      const { membershipId } = await buy(c, 'intro-3');
      await as(db, user(admin), `select pause_membership($1, current_date, current_date + 1, 'Injury', true)`, [membershipId]);
      await as(db, user(admin), `select resume_membership($1, 'Back early')`, [membershipId]);
      const { rows } = await db.query(
        `select action from audit_log where entity_id = $1 and action like 'membership_%' order by id`, [membershipId],
      );
      expect(rows.map((r) => r.action)).toEqual(['membership_created', 'membership_paused', 'membership_resumed']);
    });
  });

  // ---------------------------------------------------------------- tickets
  describe('workshop tickets', () => {
    async function workshop(capacity = 10, price: number | null = 2500, startsInMinutes = 3 * 24 * 60) {
      const id = await makeSession({ style: 'heels', startsInMinutes, capacity, isSpecial: true });
      await db.query(`update class_sessions set ticket_price_cents = $2 where id = $1`, [id, price]);
      return id;
    }
    const startTicket = async (uid: string, sessionId: string, key = randomUUID()) =>
      (await as<{ r: { payment_id: string; amount_cents: number; currency: string } }>(
        db, user(uid), `select create_ticket_checkout($1, $2, 'square') as r`, [sessionId, key],
      ))[0].r;
    const pay = async (paymentId: string, amount: number) =>
      (await as<{ r: { ok: boolean; booking_id: string | null; refund_required?: boolean; duplicate: boolean } }>(
        db, service, `select fulfill_payment($1, 'square', 'pi_t', $2, $3, 'EUR') as r`, [paymentId, `evt_${randomUUID()}`, amount],
      ))[0].r;

    it('sells a ticket at the database price and books the spot after payment', async () => {
      const c = await createUser(db, 'TicketBuyer');
      const s = await workshop();
      const t = await startTicket(c, s);
      expect(t.amount_cents).toBe(2500);
      let [b] = (await db.query(`select status from bookings where user_id = $1 and session_id = $2`, [c, s])).rows;
      expect(b.status).toBe('pending_payment');
      const r = await pay(t.payment_id, 2500);
      expect(r).toMatchObject({ ok: true, refund_required: false });
      [b] = (await db.query(`select status, membership_id from bookings where user_id = $1 and session_id = $2`, [c, s])).rows;
      expect(b).toEqual({ status: 'booked', membership_id: null });
      expect((await pay(t.payment_id, 2500)).duplicate).toBe(true);
      const { rows } = await db.query(`select booked_count from class_sessions where id = $1`, [s]);
      expect(rows[0].booked_count).toBe(1);
    });

    it('returning to a workshop resumes the checkout already in progress', async () => {
      const c = await createUser(db, 'Resumer');
      const s = await workshop();
      const first = await startTicket(c, s);
      const again = await startTicket(c, s); // different idempotency key
      expect(again.payment_id).toBe(first.payment_id);
      expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(1);
    });

    it('memberships still cannot be used for special events', async () => {
      const c = await createUser(db, 'MemberAtWorkshop');
      await buy(c, 'multi-12');
      await expectError(book(c, await workshop()), 'special_event');
    });

    it('refuses tickets for workshops without a price', async () => {
      const c = await createUser(db, 'NoTicket');
      await expectError(startTicket(c, await workshop(10, null)), 'tickets_not_available');
    });

    it('holds spots so concurrent buyers cannot oversell a workshop', async () => {
      const s = await workshop(2);
      const users = await Promise.all(Array.from({ length: 5 }, (_, i) => createUser(db, `TicketRace${i}`)));
      const clients = await Promise.all(users.map(async () => {
        const cl = new pg.Client({ connectionString: ctx.connectionString });
        await cl.connect();
        return cl;
      }));
      const results = await Promise.allSettled(users.map((u, i) =>
        as(clients[i], user(u), `select create_ticket_checkout($1, $2, 'square')`, [s, randomUUID()])));
      await Promise.all(clients.map((cl) => cl.end()));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const { rows } = await db.query(`select booked_count from class_sessions where id = $1`, [s]);
      expect(rows[0].booked_count).toBe(2);
    });

    it('releases expired holds and still honours a late payment if a spot is free', async () => {
      const a = await createUser(db, 'SlowPayer');
      const s = await workshop(1);
      const t = await startTicket(a, s);
      await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where session_id = $1`, [s]);
      const [rel] = await as<{ n: number }>(db, service, `select release_expired_holds() as n`);
      expect(rel.n).toBeGreaterThanOrEqual(1);
      expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(0);
      const r = await pay(t.payment_id, 2500);
      expect(r).toMatchObject({ ok: true, refund_required: false });
      expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(1);
    });

    it('flags a refund when a late payment arrives after the spot was taken', async () => {
      const a = await createUser(db, 'TooLate');
      const b = await createUser(db, 'GotIt');
      const s = await workshop(1);
      const ta = await startTicket(a, s);
      await db.query(`update bookings set hold_expires_at = now() - interval '1 minute' where user_id = $1 and session_id = $2`, [a, s]);
      const tb = await startTicket(b, s); // releases A's hold, takes the spot
      await pay(tb.payment_id, 2500);
      const r = await pay(ta.payment_id, 2500);
      expect(r).toMatchObject({ ok: true, booking_id: null, refund_required: true });
      const { rows } = await db.query(`select count(*)::int n from audit_log where action = 'ticket_refund_required' and entity_id = $1`, [ta.payment_id]);
      expect(rows[0].n).toBe(1);
    });

    it('an expired checkout frees the spot', async () => {
      const c = await createUser(db, 'Abandoner');
      const s = await workshop(1);
      const t = await startTicket(c, s);
      await db.query(`update payments set provider_session_id = 'cs_test_1' where id = $1`, [t.payment_id]);
      await as(db, service, `select expire_payment($1, 'cancelled', 'cs_test_1')`, [t.payment_id]);
      const [row] = (await db.query(
        `select p.status ps, b.status bs, s.booked_count from payments p join bookings b on b.id = p.booking_id join class_sessions s on s.id = p.session_id where p.id = $1`,
        [t.payment_id])).rows;
      expect(row).toEqual({ ps: 'cancelled', bs: 'cancelled', booked_count: 0 });
    });

    it('customers can abandon a hold but must contact the studio to cancel a paid ticket', async () => {
      const c = await createUser(db, 'TicketCancel');
      const s = await workshop();
      const t = await startTicket(c, s);
      const [hold] = (await db.query(`select id from bookings where payment_id = $1`, [t.payment_id])).rows;
      await as(db, user(c), `select cancel_booking($1)`, [hold.id]);
      expect((await db.query(`select status from payments where id = $1`, [t.payment_id])).rows[0].status).toBe('cancelled');

      const t2 = await startTicket(c, s);
      await pay(t2.payment_id, 2500);
      const [paid] = (await db.query(`select id from bookings where payment_id = $1`, [t2.payment_id])).rows;
      await expectError(as(db, user(c), `select cancel_booking($1)`, [paid.id]), 'ticket_contact_studio');
    });

    it('ticket sales are reported separately from memberships', async () => {
      const [r] = await as<{ r: { tickets_sold: number; ticket_revenue_cents: number } }>(db, user(admin), `select admin_ticket_sales(current_date, current_date) as r`);
      expect(r.r.tickets_sold).toBeGreaterThanOrEqual(1);
      expect(r.r.ticket_revenue_cents).toBe(r.r.tickets_sold * 2500);
    });
  });

  // ---------------------------------------------------------------- drop in
  describe('Drop In (single class without a membership)', () => {
    const dropIn = async (uid: string, sessionId: string) =>
      (await as<{ r: { payment_id: string; kind: string; amount_cents: number; plan_name: string } }>(
        db, user(uid), `select create_ticket_checkout($1, $2, 'square') as r`, [sessionId, randomUUID()],
      ))[0].r;

    it('charges €15 for FitDance, Reggaeton, Commercial and Hip Hop and €17 for other styles', async () => {
      const { rows } = await db.query(`select slug, drop_in_price_cents as p from dance_styles order by sort_order`);
      expect(Object.fromEntries(rows.map((r) => [r.slug, r.p]))).toEqual({
        fitdance: 1500, commercial: 1500, 'hip-hop': 1500, heels: 1700, 'jazz-funk': 1700, reggaeton: 1500, choreography: 1700,
      });
      const c = await createUser(db, 'DropInPrices');
      const fit = await dropIn(c, await makeSession({ style: 'fitdance', startsInMinutes: 600 }));
      expect(fit).toMatchObject({ kind: 'drop_in', amount_cents: 1500, plan_name: 'Drop In: fitdance class' });
      const heels = await dropIn(c, await makeSession({ style: 'heels', startsInMinutes: 700 }));
      expect(heels).toMatchObject({ kind: 'drop_in', amount_cents: 1700 });
    });

    it('books the class once Square confirms the payment, without touching any membership', async () => {
      const c = await createUser(db, 'DropInBooker');
      const s = await makeSession({ style: 'commercial', startsInMinutes: 800 });
      const t = await dropIn(c, s);
      const [r] = await as<{ r: { ok: boolean; booking_id: string } }>(db, service,
        `select fulfill_payment($1, 'square', 'sq_pay', $2, 1500, 'EUR') as r`, [t.payment_id, `evt_${randomUUID()}`]);
      expect(r.r.ok).toBe(true);
      const [b] = (await db.query(`select status, membership_id, payment_id from bookings where id = $1`, [r.r.booking_id])).rows;
      expect(b).toEqual({ status: 'booked', membership_id: null, payment_id: t.payment_id });
      await expectError(as(db, user(c), `select cancel_booking($1)`, [r.r.booking_id]), 'ticket_contact_studio');
    });

    it('follows the 3-week booking window and refuses styles without a Drop In price', async () => {
      const c = await createUser(db, 'DropInRules');
      await expectError(dropIn(c, await makeSession({ style: 'hip-hop', startsInMinutes: 22 * 24 * 60 })), 'outside_booking_window');
      await db.query(`update dance_styles set drop_in_price_cents = null where slug = 'reggaeton'`);
      try {
        await expectError(dropIn(c, await makeSession({ style: 'reggaeton', startsInMinutes: 900 })), 'drop_in_not_available');
      } finally {
        await db.query(`update dance_styles set drop_in_price_cents = 1500 where slug = 'reggaeton'`);
      }
    });

    it('booking options show the Drop In price, also to visitors who are not logged in', async () => {
      const s = await makeSession({ style: 'jazz-funk', startsInMinutes: 950 });
      const [o] = await as<{ r: { drop_in_price_cents: number } }>(db, anon, `select booking_options($1) as r`, [s]);
      expect(o.r.drop_in_price_cents).toBe(1700);
    });

    it('keeps the booking → payment link name the app relies on', async () => {
      // src/api: bookings ... payment:payments!bookings_payment_id_fkey(kind)
      const { rows } = await db.query(
        `select conname from pg_constraint where conrelid = 'public.bookings'::regclass and contype = 'f' and conname = 'bookings_payment_id_fkey'`,
      );
      expect(rows).toHaveLength(1);
    });

    it('reports Drop In sales separately', async () => {
      const [r] = await as<{ r: { drop_ins_sold: number; drop_in_revenue_cents: number } }>(db, user(admin), `select admin_ticket_sales(current_date, current_date) as r`);
      expect(r.r.drop_ins_sold).toBeGreaterThanOrEqual(1);
      expect(r.r.drop_in_revenue_cents).toBeGreaterThanOrEqual(1500);
    });
  });

  // ---------------------------------------------------------------- photos
  describe('profile photo', () => {
    it('is not needed for the first class, but is from the second booking on', async () => {
      const c = await createUser(db, 'NoPhoto', 'customer', { photo: false });
      const s = await makeSession({ style: 'heels', startsInMinutes: 1000 });
      const s2 = await makeSession({ style: 'heels', startsInMinutes: 2000 });
      const [o] = await as<{ r: { has_profile_photo: boolean } }>(db, user(c), `select booking_options($1) as r`, [s]);
      expect(o.r.has_profile_photo).toBe(true);
      await as(db, user(c), `select create_ticket_checkout($1, $2)`, [s, randomUUID()]); // first class: fine without a photo
      await expectError(as(db, user(c), `select create_ticket_checkout($1, $2)`, [s2, randomUUID()]), 'profile_photo_required');
      await expectError(as(db, user(c), `select create_checkout($1, null, $2)`, [await planId('multi-5'), randomUUID()]), 'profile_photo_required');
      const [o1] = await as<{ r: { has_profile_photo: boolean } }>(db, user(c), `select booking_options($1) as r`, [s2]);
      expect(o1.r.has_profile_photo).toBe(false);

      // Upload into their own folder, then everything works.
      await as(db, user(c), `insert into storage.objects (bucket_id, name, owner) values ('avatars', $1 || '/me.jpg', $1::uuid)`, [c]);
      await as(db, user(c), `update profiles set avatar_path = $1 || '/me.jpg' where id = $1::uuid`, [c]);
      const [o2] = await as<{ r: { has_profile_photo: boolean } }>(db, user(c), `select booking_options($1) as r`, [s2]);
      expect(o2.r.has_profile_photo).toBe(true);
      await as(db, user(c), `select create_checkout($1, null, $2)`, [await planId('multi-5'), randomUUID()]);
    });

    it("customers can't upload into, or point at, someone else's folder", async () => {
      const a = await createUser(db, 'PhotoOwner');
      const b = await createUser(db, 'PhotoIntruder', 'customer', { photo: false });
      await expect(as(db, user(b), `insert into storage.objects (bucket_id, name, owner) values ('avatars', $1 || '/x.jpg', $2::uuid)`, [a, b]))
        .rejects.toThrow(/row-level security/);
      await expect(as(db, user(b), `update profiles set avatar_path = $1 || '/photo.jpg' where id = $2::uuid`, [a, b]))
        .rejects.toThrow(/invalid_avatar_path/);
      expect(await as(db, user(b), `select name from storage.objects where bucket_id = 'avatars' and name like $1 || '/%'`, [a])).toHaveLength(0);
    });

    it('staff can see customer photos for check-in', async () => {
      const c = await createUser(db, 'PhotoVisible');
      const rows = await as(db, user(admin), `select name from storage.objects where bucket_id = 'avatars' and name like $1 || '/%'`, [c]);
      expect(rows).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------- staff
  describe('class numbers are for staff only', () => {
    it("the public can't read how many are booked; the timetable only says almost full / fully booked", async () => {
      await expect(as(db, anon, `select booked_count from class_sessions limit 1`)).rejects.toThrow(/permission denied/);
      await expect(as(db, user(await createUser(db, 'Curious')), `select capacity from class_sessions limit 1`)).rejects.toThrow(/permission denied/);
      const s = await makeSession({ style: 'heels', startsInMinutes: 400, capacity: 30 });
      const avail = async () => {
        const [r] = await as<{ t: { availability: string; booked_count?: number; capacity?: number }[] }>(
          db, anon, `select timetable(null, null, $1) as t`, [s]);
        expect(r.t[0].booked_count).toBeUndefined();
        expect(r.t[0].capacity).toBeUndefined();
        return r.t[0].availability;
      };
      await db.query(`update class_sessions set booked_count = 19 where id = $1`, [s]);
      expect(await avail()).toBe('available');
      await db.query(`update class_sessions set booked_count = 20 where id = $1`, [s]);
      expect(await avail()).toBe('almost_full'); // 10 spots left
      await db.query(`update class_sessions set booked_count = 30 where id = $1`, [s]);
      expect(await avail()).toBe('full');
    });

    it('timetable ranges are capped and alternatives carry no numbers', async () => {
      const [r] = await as<{ t: unknown[] }>(db, anon, `select timetable(now(), now() + interval '90 days') as t`);
      expect(r.t).toEqual([]);
      const c = await createUser(db, 'AltNumbers');
      await buy(c, 'single-4', 'heels');
      const hiphop = await makeSession({ style: 'hip-hop', startsInMinutes: 500 });
      await makeSession({ style: 'heels', startsInMinutes: 520 });
      const [o] = await as<{ r: { alternatives: Record<string, unknown>[] } }>(db, user(c), `select booking_options($1) as r`, [hiphop]);
      expect(o.r.alternatives.length).toBeGreaterThan(0);
      for (const a of o.r.alternatives) {
        expect(a).not.toHaveProperty('spots_left');
        expect(['available', 'almost_full', 'full']).toContain(a.availability);
      }
    });
  });

  it('admins can edit a member’s profile, and every change is audited', async () => {
    const m = await createUser(db, 'EditMe');
    await expectError(as(db, user(m), `select admin_update_member($1, 'Hacker', null, null, false, true, true)`, [m]), 'forbidden');
    await expectError(as(db, user(admin), `select admin_update_member($1, '  ', null, null, false, true, true)`, [m]), 'name_required');
    await expectError(as(db, user(admin), `select admin_update_member($1, 'Edit Me', null, '2999-01-01', false, true, true)`, [m]), 'invalid_date_of_birth');
    await as(db, user(admin), `select admin_update_member($1, 'Edit Me Too', '087 123 4567', '1995-06-01', true, false, true, true)`, [m]);
    const { rows: [p] } = await db.query(`select full_name, phone, date_of_birth::text dob, marketing_opt_in, notify_email, notify_push, avatar_path from profiles where id = $1`, [m]);
    expect(p).toMatchObject({ full_name: 'Edit Me Too', phone: '087 123 4567', dob: '1995-06-01', marketing_opt_in: true, notify_email: false, notify_push: true, avatar_path: null });
    const { rows: [a] } = await db.query(`select details from audit_log where action = 'member_updated' and entity_id = $1`, [m]);
    expect(a.details.full_name).toEqual({ from: 'EditMe', to: 'Edit Me Too' });
    await expect(as(db, user(admin), `select admin_record_member_email($1, 'x@y.ie', $1)`, [m])).rejects.toThrow(/permission denied/);
  });

  it('admins can cancel a class pack (upcoming bookings cancelled, member told) and reinstate it', async () => {
    const m = await createUser(db, 'CancelMe');
    const { membershipId } = await buy(m, 'intro-3');
    const s = await makeSession({ style: 'fitdance', startsInMinutes: 2000 });
    await book(m, s);
    await expectError(as(db, user(m), `select admin_cancel_membership($1, 'x')`, [membershipId]), 'forbidden');
    await expectError(as(db, user(admin), `select admin_cancel_membership($1, ' ')`, [membershipId]), 'reason_required');
    const [r] = await as<{ r: { bookings_cancelled: number } }>(db, user(admin), `select admin_cancel_membership($1, 'Moving abroad') r`, [membershipId]);
    expect(r.r.bookings_cancelled).toBe(1);
    expect((await db.query(`select admin_status from memberships where id = $1`, [membershipId])).rows[0].admin_status).toBe('cancelled');
    expect((await db.query(`select status from bookings where user_id = $1 and session_id = $2`, [m, s])).rows[0].status).toBe('cancelled');
    expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'membership_cancelled'`, [m])).rows[0].n).toBe(1);
    await expectError(as(db, user(m), `select book_class($1, $2)`, [await makeSession({ style: 'fitdance', startsInMinutes: 3000 }), membershipId]), 'membership_cancelled');
    await as(db, user(admin), `select admin_reinstate_membership($1, 'Changed their mind')`, [membershipId]);
    expect((await db.query(`select admin_status from memberships where id = $1`, [membershipId])).rows[0].admin_status).toBe('valid');
  });

  it('members need a mobile number to pay, and the Intro Offer is once per mobile number', async () => {
    const noPhone = await createUser(db, 'NoPhone', 'customer', { phone: null });
    await expectError(as(db, user(noPhone), `select create_checkout($1, null, $2, 'square')`, [await planId('multi-5'), randomUUID()]), 'phone_required');
    const first = await createUser(db, 'FirstIntro', 'customer', { phone: '087 555 0101' });
    await buy(first, 'intro-3');
    // Same number written differently on a second account.
    const second = await createUser(db, 'SecondIntro', 'customer', { phone: '+353 87 555 0101' });
    await expectError(as(db, user(second), `select create_checkout($1, null, $2, 'square')`, [await planId('intro-3'), randomUUID()]), 'intro_not_eligible');
    const [shared] = await as<{ r: { id: string }[] }>(db, user(admin), `select admin_shared_phone($1) r`, [second]);
    expect(shared.r.map((x) => x.id)).toEqual([first]);
    await expectError(as(db, user(second), `select admin_shared_phone($1)`, [second]), 'forbidden');
  });

  it('unpaid ticket holds last 5 minutes', async () => {
    const m = await createUser(db, 'Holder');
    const s = await makeSession({ style: 'heels', startsInMinutes: 3000, isSpecial: true });
    await db.query(`update class_sessions set ticket_price_cents = 2000 where id = $1`, [s]);
    await as(db, user(m), `select create_ticket_checkout($1, $2)`, [s, randomUUID()]);
    const { rows: [b] } = await db.query(`select extract(epoch from hold_expires_at - now())::int secs from bookings where user_id = $1 and session_id = $2`, [m, s]);
    expect(b.secs).toBeGreaterThan(240);
    expect(b.secs).toBeLessThanOrEqual(300);
  });

  it('after unpausing, a member waits 10 days before pausing again (admins can still pause)', async () => {
    const m = await createUser(db, 'Cooldown');
    const { membershipId } = await buy(m, 'intro-3');
    // A pause that started 5 days ago, ended early today.
    await db.query(`insert into membership_pauses (membership_id, user_id, starts_on, ends_on, original_ends_on) values ($1, $2, current_date - 5, current_date + 5, current_date + 5)`, [membershipId, m]);
    await as(db, user(m), `select resume_membership($1)`, [membershipId]);
    await expectError(as(db, user(m), `select pause_membership($1, current_date + 1, current_date + 8)`, [membershipId]), 'pause_cooldown');
    await expectError(as(db, user(m), `select pause_membership($1, current_date + 9, current_date + 16)`, [membershipId]), 'pause_cooldown');
    await as(db, user(admin), `select pause_membership($1, current_date + 1, current_date + 8, 'Injury', true)`, [membershipId]);
  });

  it('managers run the studio but see no revenue, payments, refunds or roles', async () => {
    const mgr = await createUser(db, 'Manager', 'customer');
    await as(db, user(admin), `select admin_set_access($1, 'manager')`, [mgr]);
    expect((await db.query(`select role, finance_access from profiles where id = $1`, [mgr])).rows[0]).toEqual({ role: 'admin', finance_access: false });
    await expectError(as(db, user(mgr), `select admin_analytics(current_date - 30, current_date)`), 'finance_only');
    await expectError(as(db, user(mgr), `select admin_ticket_sales(current_date - 30, current_date)`), 'finance_only');
    await expectError(as(db, user(mgr), `select admin_set_role($1, 'admin')`, [mgr]), 'finance_only');
    await expectError(as(db, user(mgr), `select admin_set_access($1, 'full_admin')`, [mgr]), 'finance_only');
    const [d] = await as<{ r: Record<string, unknown> }>(db, user(mgr), `select admin_dashboard() r`);
    expect(d.r).not.toHaveProperty('revenue_week_cents');
    expect(d.r.finance).toBe(false);
    const payer = await createUser(db, 'PaidSomething');
    await buy(payer, 'intro-3');
    expect(await as(db, user(mgr), `select id from payments where user_id = $1`, [payer])).toHaveLength(0);
    expect((await as(db, user(admin), `select id from payments where user_id = $1`, [payer])).length).toBeGreaterThan(0);
    // Still a working admin: can see members and memberships.
    expect((await as(db, user(mgr), `select id from memberships where user_id = $1`, [payer])).length).toBe(1);
  });

  it('first-timers buying a Drop In can bring a friend free; the friend leaves with them', async () => {
    const m = await createUser(db, 'Newcomer');
    const s = await makeSession({ style: 'fitdance', startsInMinutes: 3000, capacity: 10 });
    const [ok] = await as<{ r: boolean }>(db, user(m), `select friend_offer($1) r`, [s]);
    expect(ok.r).toBe(true);
    const [c] = await as<{ r: { amount_cents: number } }>(db, user(m), `select create_ticket_checkout($1, $2, 'square', 'Sarah') r`, [s, randomUUID()]);
    const price = (await db.query(`select drop_in_price_cents p from dance_styles where slug = 'fitdance'`)).rows[0].p;
    expect(c.r.amount_cents).toBe(price);
    expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(2);
    const [roster] = await as<{ r: { bookings: { guest_name: string }[] } }>(db, user(admin), `select staff_roster($1) r`, [s]);
    expect(roster.r.bookings[0].guest_name).toBe('Sarah');
    // Released hold frees both spots.
    const { rows: [b] } = await db.query(`select id from bookings where user_id = $1 and session_id = $2`, [m, s]);
    await db.query(`update bookings set status = 'cancelled' where id = $1`, [b.id]);
    expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(1);
    // Not for people who've been before.
    const regular = await createUser(db, 'Regular');
    await buy(regular, 'intro-3');
    const [no] = await as<{ r: boolean }>(db, user(regular), `select friend_offer($1) r`, [s]);
    expect(no.r).toBe(false);
    await expectError(as(db, user(regular), `select create_ticket_checkout($1, $2, 'square', 'Pal')`, [s, randomUUID()]), 'friend_offer_not_eligible');
  });

  it('asks for feedback after the first class in a style, every 6th, and after events', async () => {
    const m = await createUser(db, 'Rater');
    const { membershipId } = await buy(m, 'multi-8');
    await db.query(`update memberships set classes_remaining = 20 where id = $1`, [membershipId]);
    const done: string[] = [];
    for (let k = 0; k < 6; k++) {
      const s = await makeSession({ style: 'reggaeton', startsInMinutes: 60 * 24 * (k + 1) });
      await book(m, s);
      // Move the class into the past (ended 2 hours ago, older ones earlier).
      await db.query(`update class_sessions set starts_at = now() - make_interval(hours => 3 + (6 - $2) * 24), ends_at = now() - make_interval(hours => 2 + (6 - $2) * 24) where id = $1`, [s, k]);
      done.push(s);
    }
    await as(db, service, `select queue_feedback_requests()`);
    const { rows } = await db.query(`select reason, session_id from class_feedback where user_id = $1 order by requested_at`, [m]);
    // Classes older than 2 days aren't asked about; of the recent ones, only the 6th in the style qualifies.
    expect(rows.map((r) => r.reason)).toEqual(['every_6']);
    const [reqs] = await as<{ r: { id: string }[] }>(db, user(m), `select my_feedback_requests() r`);
    await expectError(as(db, user(m), `select submit_feedback($1, 9)`, [reqs.r[0].id]), 'invalid_rating');
    await as(db, user(m), `select submit_feedback($1, 5, 'Loved it', true)`, [reqs.r[0].id]);
    await expectError(as(db, user(m), `select submit_feedback($1, 4)`, [reqs.r[0].id]), 'feedback_already_sent');
    const [all] = await as<{ r: { rating: number; member: string | null }[] }>(db, user(admin), `select staff_feedback() r`);
    expect(all.r.find((x) => x.rating === 5)?.member).toBe('Rater');
    expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'feedback_request'`, [m])).rows[0].n).toBe(1);
  });

  describe('instructor view', () => {
    async function teacher(name: string) {
      const uid = await createUser(db, name);
      const { rows: [i] } = await db.query(`insert into instructors (full_name) values ($1) returning id`, [name]);
      await as(db, user(admin), `select admin_link_instructor($1, $2)`, [i.id, `${name.toLowerCase()}@example.com`]);
      await db.query(`update profiles set date_of_birth = '1990-03-10' where id = $1`, [uid]);
      return { uid, instructorId: i.id as string };
    }

    it('instructors can book any class for themselves, free, within capacity', async () => {
      const t = await teacher('Freebie');
      const other = await teacher('Colleague');
      const s = await taughtBy(other.instructorId, 600, 'commercial'); // not their own class
      const [r] = await as<{ r: { booking_id: string } }>(db, user(t.uid), `select staff_book_self($1) r`, [s]);
      const { rows: [b] } = await db.query(`select membership_id, payment_id, staff_free, status from bookings where id = $1`, [r.r.booking_id]);
      expect(b).toMatchObject({ membership_id: null, payment_id: null, staff_free: true, status: 'booked' });
      expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(1);
      await expectError(as(db, user(t.uid), `select staff_book_self($1)`, [s]), 'already_booked');

      // Their colleague sees them on the list as staff; they can cancel it themselves.
      const [roster] = await as<{ r: { bookings: { kind: string }[] } }>(db, user(other.uid), `select staff_roster($1) r`, [s]);
      expect(roster.r.bookings.map((x) => x.kind)).toEqual(['staff']);
      await as(db, user(t.uid), `select cancel_booking($1)`, [r.r.booking_id]);
      expect((await db.query(`select booked_count from class_sessions where id = $1`, [s])).rows[0].booked_count).toBe(0);

      // Members can't; a full class stays full.
      const m = await createUser(db, 'NotStaff');
      await expectError(as(db, user(m), `select staff_book_self($1)`, [s]), 'forbidden');
      await db.query(`update class_sessions set booked_count = capacity where id = $1`, [s]);
      await expectError(as(db, user(t.uid), `select staff_book_self($1)`, [s]), 'session_full');
    });

    it('instructors must add their birthday before using the teacher view', async () => {
      const t = await teacher('Zublin');
      const s = await taughtBy(t.instructorId, 600);
      await db.query(`update profiles set date_of_birth = null where id = $1`, [t.uid]);
      await expectError(as(db, user(t.uid), `select staff_sessions(now(), now() + interval '14 days')`), 'dob_required');
      await expectError(as(db, user(t.uid), `select staff_roster($1)`, [s]), 'dob_required');
      await as(db, user(t.uid), `update profiles set date_of_birth = '1988-01-02' where id = $1`, [t.uid]);
      const [r] = await as<{ r: unknown[] }>(db, user(t.uid), `select staff_sessions(now(), now() + interval '14 days') r`);
      expect(r.r.length).toBeGreaterThanOrEqual(1);
    });

    it('admins are told about instructor birthdays a week before and on the day', async () => {
      const t = await teacher('Birthdayteacher');
      const { rows: [{ tz }] } = await db.query(`select timezone tz from app_settings`);
      const { rows: [{ late }] } = await db.query(`select (now() at time zone $1)::time >= '09:00' late`, [tz]);
      const setDob = (days: number) => db.query(
        `update profiles set date_of_birth = ((now() at time zone $2)::date + $3::int) - interval '30 years' where id = $1`, [t.uid, tz, days]);
      const mine = async () => (await db.query(
        `select payload->>'phase' phase from notification_outbox where user_id = $1 and kind = 'instructor_birthday' and payload->>'instructor_name' = 'Birthdayteacher' order by id`, [admin])).rows.map((r) => r.phase);

      await setDob(7);
      await as(db, service, `select queue_instructor_birthday_alerts()`);
      await as(db, service, `select queue_instructor_birthday_alerts()`);
      expect(await mine()).toEqual(late ? ['week_before'] : []);
      await setDob(0);
      await as(db, service, `select queue_instructor_birthday_alerts()`);
      expect(await mine()).toEqual(late ? ['week_before', 'on_day'] : []);
      // The instructor isn't told about their own birthday, and members can't run the job or see the list.
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'instructor_birthday'`, [t.uid])).rows[0].n).toBe(0);
      await expect(as(db, user(t.uid), `select queue_instructor_birthday_alerts()`)).rejects.toThrow(/permission denied/);
      await expectError(as(db, user(t.uid), `select admin_instructor_birthdays()`), 'forbidden');
      const [list] = await as<{ r: { instructor_id: string; next_birthday: string }[] }>(db, user(admin), `select admin_instructor_birthdays() r`);
      expect(list.r.find((x) => x.instructor_id === t.instructorId)?.next_birthday).toBeTruthy();
    });
    async function taughtBy(instructorId: string, startsInMinutes: number, style = 'heels') {
      const s = await makeSession({ style, startsInMinutes });
      await db.query(`update class_sessions set instructor_id = $2 where id = $1`, [s, instructorId]);
      return s;
    }

    it('an instructor themes their class: their people are told, everyone booked gets the details', async () => {
      const t = await teacher('Themer');
      const other = await teacher('OtherTeacher');
      const past = await taughtBy(t.instructorId, 600, 'fitdance');
      const target = await taughtBy(t.instructorId, 3000, 'fitdance');
      const fan = await createUser(db, 'Fan');          // took their class recently
      const booked = await createUser(db, 'BookedIn');  // already booked on the themed class
      const stranger = await createUser(db, 'Stranger'); // only took another teacher's class
      for (const u of [fan, booked, stranger]) await buy(u, 'multi-8');
      await book(fan, past);
      await book(booked, target);
      await book(stranger, await taughtBy(other.instructorId, 700, 'fitdance'));
      // An old booking (more than 3 months ago) doesn't count.
      const old = await createUser(db, 'LongAgo');
      const oldS = await taughtBy(t.instructorId, 600, 'fitdance');
      await db.query(`update class_sessions set starts_at = now() - interval '4 months', ends_at = now() - interval '4 months' + interval '1 hour' where id = $1`, [oldS]);
      await db.query(`insert into bookings (user_id, session_id, status) values ($1, $2, 'attended')`, [old, oldS]);

      const [count] = await as<{ n: number }>(db, user(t.uid), `select event_audience_count() n`);
      expect(count.n).toBe(2); // fan + booked
      await expectError(as(db, user(t.uid), `select organise_special_class($1, 'All Black')`, [await taughtBy(other.instructorId, 3000)]), 'forbidden');
      await expectError(as(db, user(fan), `select organise_special_class($1, 'All Black')`, [target]), 'forbidden');

      const [r] = await as<{ r: { event_id: string; announced: number; booked_told: number } }>(db, user(t.uid),
        `select organise_special_class($1, 'All Black FitDance', 'Our all black class!', 'Black', 'UV lights', 'Licorice') r`, [target]);
      expect(r.r).toMatchObject({ announced: 1, booked_told: 1 });
      const kinds = async (u: string) => (await db.query(`select kind from notification_outbox where user_id = $1 and kind like 'event_%' order by id`, [u])).rows.map((x) => x.kind);
      expect(await kinds(fan)).toEqual(['event_announced']);
      expect(await kinds(booked)).toEqual(['event_details']);
      expect(await kinds(stranger)).toEqual([]);
      expect(await kinds(old)).toEqual([]);
      expect(await kinds(admin)).toEqual(['event_organised']);
      const { rows: [n] } = await db.query(`select payload from notification_outbox where user_id = $1 and kind = 'event_details'`, [booked]);
      expect(n.payload).toMatchObject({ title: 'All Black FitDance', dress_code: 'Black', instructor: 'Themer' });
      expect(n.payload).not.toHaveProperty('decorations');
      await expectError(as(db, user(t.uid), `select organise_special_class($1, 'Again')`, [target]), 'already_an_event');

      // Members see the theme on the timetable; booking later sends the details once.
      const [tt] = await as<{ r: { event: { title: string; dress_code: string } }[] }>(db, anon, `select timetable(null, null, $1) r`, [target]);
      expect(tt.r[0].event).toMatchObject({ title: 'All Black FitDance', dress_code: 'Black' });
      await book(fan, target);
      expect(await kinds(fan)).toEqual(['event_announced', 'event_details']);

      // Taking the theme off tells everyone booked.
      await as(db, user(t.uid), `select cancel_event($1, 'Change of plan')`, [r.r.event_id]);
      expect(await kinds(booked)).toEqual(['event_details', 'event_cancelled']);
      const [tt2] = await as<{ r: { event: unknown }[] }>(db, anon, `select timetable(null, null, $1) r`, [target]);
      expect(tt2.r[0].event).toBeNull();
    });

    it('workshops must fit the studio, need admin approval and can have a member price', async () => {
      const t = await teacher('Workshopper');
      const st = await styleId('heels');
      const base = `date_trunc('day', now()) + interval '45 days'`;
      const clash = await makeSession({ style: 'heels', startsInMinutes: 10 * 24 * 60 });
      const { rows: [c] } = await db.query(`select starts_at, ends_at from class_sessions where id = $1`, [clash]);
      await expectError(as(db, user(t.uid), `select request_workshop('Heels Workshop', $1, $2, $3, 20, 3000)`, [st, c.starts_at, c.ends_at]), 'studio_busy');
      await expectError(as(db, user(t.uid), `select request_workshop('Too soon', $1, now() + interval '1 day', now() + interval '1 day 2 hours', 20, 3000)`, [st]), 'workshop_too_soon');
      await expectError(as(db, user(t.uid), `select request_workshop('Bad price', $1, ${base} + interval '1 day', ${base} + interval '1 day 2 hours', 20, 3000, 4000)`, [st]), 'invalid_price');

      const [w] = await as<{ r: { event_id: string } }>(db, user(t.uid),
        `select request_workshop('Heels Workshop', $1, ${base} + interval '1 day 3 hours', ${base} + interval '1 day 5 hours', 20, 3000, 2000, 'Learn a full routine', 'Heels!') r`, [st]);
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'event_request'`, [admin])).rows[0].n).toBe(1);
      // A second request on top of a pending one is refused, and members can't approve.
      await expectError(as(db, user(t.uid), `select request_workshop('Overlap', $1, ${base} + interval '1 day 4 hours', ${base} + interval '1 day 6 hours', 20, 3000)`, [st]), 'studio_busy');
      await expectError(as(db, user(t.uid), `select admin_decide_workshop($1, true)`, [w.r.event_id]), 'forbidden');

      const [d] = await as<{ r: { session_id: string } }>(db, user(admin), `select admin_decide_workshop($1, true, 'Go for it') r`, [w.r.event_id]);
      const { rows: [s] } = await db.query(`select is_special, ticket_price_cents, member_ticket_price_cents, instructor_id from class_sessions where id = $1`, [d.r.session_id]);
      expect(s).toMatchObject({ is_special: true, ticket_price_cents: 3000, member_ticket_price_cents: 2000, instructor_id: t.instructorId });
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'event_decided'`, [t.uid])).rows[0].n).toBe(1);

      // Members pay the member price, everyone else the full price.
      const member = await createUser(db, 'WorkshopMember');
      await buy(member, 'multi-5');
      const guest = await createUser(db, 'WorkshopGuest');
      const price = async (u: string) => (await as<{ r: { amount_cents: number } }>(db, user(u), `select create_ticket_checkout($1, $2) r`, [d.r.session_id, randomUUID()]))[0].r.amount_cents;
      expect(await price(member)).toBe(2000);
      expect(await price(guest)).toBe(3000);

      // What's left after Square's fee is split 70/30 between the instructor and the studio.
      for (const u of [member, guest]) {
        const { rows: [pay] } = await db.query(`select id, amount_cents from payments where user_id = $1 and session_id = $2`, [u, d.r.session_id]);
        await as(db, service, `select fulfill_payment($1, 'square', $2, $3, $4, 'EUR')`, [pay.id, `pi_${randomUUID()}`, `evt_${randomUUID()}`, pay.amount_cents]);
      }
      const [mine] = await as<{ r: { status: string; session: { id: string }; tickets_sold: number; ticket_revenue_cents: number; instructor_share_pct: number;
        instructor_earnings_cents: number; studio_earnings_cents: number }[] }>(db, user(t.uid), `select my_events() r`);
      expect(mine.r[0]).toMatchObject({ status: 'published', session: { id: d.r.session_id }, tickets_sold: 2, ticket_revenue_cents: 5000,
        fees_pending: 2, instructor_share_pct: 70, instructor_earnings_cents: 3500, studio_earnings_cents: 1500 });
      const pays = (await db.query(`select id from payments where session_id = $1 and status = 'succeeded' order by amount_cents`, [d.r.session_id])).rows;
      await as(db, service, `select record_payment_fee($1, 53)`, [pays[0].id]);  // member €20
      await as(db, service, `select record_payment_fee($1, 67)`, [pays[1].id]);  // guest €30
      await expect(as(db, user(t.uid), `select record_payment_fee($1, 0)`, [pays[0].id])).rejects.toThrow(/permission denied/);
      const [after] = await as<{ r: { fees_cents: number; fees_pending: number; net_revenue_cents: number; instructor_earnings_cents: number; studio_earnings_cents: number }[] }>(
        db, user(t.uid), `select my_events() r`);
      expect(after.r[0]).toMatchObject({ fees_cents: 120, fees_pending: 0, net_revenue_cents: 4880, instructor_earnings_cents: 3416, studio_earnings_cents: 1464 });
      // The instructor can change the details, but not the price once tickets are sold, nor go below the people booked.
      await expectError(as(db, user(t.uid), `select update_event($1, 'Heels Workshop', null, null, null, null, 20, 2500, 2000)`, [w.r.event_id]), 'price_locked');
      await expectError(as(db, user(t.uid), `select update_event($1, 'Heels Workshop', null, null, null, null, 1, 3000, 2000)`, [w.r.event_id]), 'capacity_below_booked');
      await as(db, user(t.uid), `select update_event($1, 'Heels & Heart Workshop', 'New text', 'Red', null, null, 25, 3000, 2000)`, [w.r.event_id]);
      expect((await db.query(`select title, capacity from class_sessions where id = $1`, [d.r.session_id])).rows[0]).toEqual({ title: 'Heels & Heart Workshop', capacity: 25 });

      // Reschedule: must be free; the ticket holders are told.
      await expectError(as(db, user(t.uid), `select reschedule_event($1, null, $2, $3)`, [w.r.event_id, c.starts_at, c.ends_at]), 'studio_busy');
      await as(db, user(t.uid), `select reschedule_event($1, null, ${base} + interval '2 days 3 hours', ${base} + interval '2 days 5 hours', 'Sorry!')`, [w.r.event_id]);
      const moved = (await db.query(`select payload from notification_outbox where user_id = $1 and kind = 'event_rescheduled'`, [member])).rows;
      expect(moved).toHaveLength(1);
      expect(moved[0].payload).toMatchObject({ audience: 'ticket', note: 'Sorry!' });
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'event_staff_change' and payload->>'event_id' = $2 and payload->>'action' = 'rescheduled'`, [admin, w.r.event_id])).rows[0].n).toBe(1);
      const other = await teacher('NotTheOrganiser');
      await expectError(as(db, user(other.uid), `select reschedule_event($1, null, ${base} + interval '3 days', ${base} + interval '3 days 2 hours')`, [w.r.event_id]), 'forbidden');

      // Cancelling a paid workshop cancels the class and flags the tickets for a refund.
      await expectError(as(db, user(t.uid), `select cancel_event($1)`, [w.r.event_id]), 'reason_required');
      const [cx] = await as<{ r: { notified: number } }>(db, user(t.uid), `select cancel_event($1, 'Injured, sorry') r`, [w.r.event_id]);
      expect(cx.r.notified).toBe(2);
      expect((await db.query(`select status from class_sessions where id = $1`, [d.r.session_id])).rows[0].status).toBe('cancelled');
      expect((await db.query(`select status from studio_events where id = $1`, [w.r.event_id])).rows[0].status).toBe('cancelled');
    });

    it('a theme can be moved to another of the instructor’s classes, by them or an admin', async () => {
      const t = await teacher('Mover');
      const fan = await createUser(db, 'MoveFan');
      const onOld = await createUser(db, 'OnOld');
      const onNew = await createUser(db, 'OnNew');
      for (const u of [fan, onOld, onNew]) await buy(u, 'multi-8');
      await book(fan, await taughtBy(t.instructorId, 600, 'fitdance'));
      const from = await taughtBy(t.instructorId, 3000, 'fitdance');
      const to = await taughtBy(t.instructorId, 6000, 'fitdance');
      await book(onOld, from);
      await book(onNew, to);
      const [r] = await as<{ r: { event_id: string } }>(db, user(t.uid), `select organise_special_class($1, 'Halloween FitDance', null, 'Costumes') r`, [from]);
      const [mv] = await as<{ r: { notified: number } }>(db, user(admin), `select reschedule_event($1, $2) r`, [r.r.event_id, to]);
      expect(mv.r.notified).toBe(3); // old class, new class, the fan
      const kinds = async (u: string) => (await db.query(`select kind from notification_outbox where user_id = $1 and kind like 'event_%' order by id`, [u])).rows.map((x) => x.kind);
      expect(await kinds(onOld)).toEqual(['event_details', 'event_rescheduled']);
      expect(await kinds(onNew)).toEqual(['event_announced', 'event_details']);
      expect(await kinds(fan)).toEqual(['event_announced', 'event_rescheduled']);
      const [tt] = await as<{ r: { id: string; event: { title: string } | null }[] }>(db, anon, `select timetable(null, null, $1) r`, [to]);
      expect(tt.r[0].event?.title).toBe('Halloween FitDance');
      // Only the organiser's own classes, and the name can be changed.
      const other = await teacher('SomeoneElse');
      await expectError(as(db, user(t.uid), `select reschedule_event($1, $2)`, [r.r.event_id, await taughtBy(other.instructorId, 5000)]), 'forbidden');
      await as(db, user(t.uid), `select update_event($1, 'Spooky FitDance', 'Boo', 'Costumes')`, [r.r.event_id]);
      expect((await db.query(`select title, description from studio_events where id = $1`, [r.r.event_id])).rows[0]).toEqual({ title: 'Spooky FitDance', description: 'Boo' });
    });

    it('instructors can’t change an approved workshop price or spam events', async () => {
      const t = await teacher('Hardened');
      const st = await styleId('heels');
      const base = `date_trunc('day', now()) + interval '70 days'`;
      const [w] = await as<{ r: { event_id: string } }>(db, user(t.uid),
        `select request_workshop('Price Test', $1, ${base} + interval '10 hours', ${base} + interval '12 hours', 20, 3000) r`, [st]);
      await as(db, user(admin), `select admin_decide_workshop($1, true)`, [w.r.event_id]);
      await expectError(as(db, user(t.uid), `select update_event($1, 'Price Test', null, null, null, null, 20, 100, null)`, [w.r.event_id]), 'price_change_needs_admin');
      await as(db, user(admin), `select update_event($1, 'Price Test', null, null, null, null, 20, 2500, null)`, [w.r.event_id]);
      const sessions = await Promise.all([1, 2, 3].map((d) => taughtBy(t.instructorId, 3000 + d * 1440, 'heels')));
      await as(db, user(t.uid), `select organise_special_class($1, 'One')`, [sessions[0]]);
      await as(db, user(t.uid), `select organise_special_class($1, 'Two')`, [sessions[1]]);
      await expectError(as(db, user(t.uid), `select organise_special_class($1, 'Three')`, [sessions[2]]), 'too_many_events');
    });

    it('instructors are asked to plan next month in the last week of the month', async () => {
      const t = await teacher('Planner');
      const { rows: [{ tz }] } = await db.query(`select timezone tz from app_settings`);
      const { rows: [x] } = await db.query(
        `select (now() at time zone $1)::time >= '10:00' late,
                (now() at time zone $1)::date >= (date_trunc('month', (now() at time zone $1)::date) + interval '1 month')::date - 7 lastweek`, [tz]);
      await as(db, service, `select queue_event_notifications()`);
      await as(db, service, `select queue_event_notifications()`);
      const { rows } = await db.query(`select payload from notification_outbox where user_id = $1 and kind = 'event_prompt'`, [t.uid]);
      expect(rows.length).toBe(x.late && x.lastweek ? 1 : 0);
      // The themes for any month come from the calendar (Easter-based ones included).
      const [th] = await as<{ r: { name: string; on: string | null }[] }>(db, service, `select _themes_for_month('2027-03-01') r`);
      expect(th.r.map((z) => z.name)).toEqual(expect.arrayContaining(["St Patrick's Day", "Mother's Day", "Easter"]));
      expect(th.r.find((z) => z.name === 'Easter')?.on).toBe('2027-03-28');
      await expectError(as(db, user(await createUser(db, 'Nosy')), `select upcoming_themes()`), 'forbidden');
    });

    it('members booked into an instructor’s classes hear about the birthday a week before and on the day', async () => {
      const t2 = await teacher('Bdayteach');
      const { rows: [{ tz }] } = await db.query(`select timezone tz from app_settings`);
      const { rows: [{ late }] } = await db.query(`select (now() at time zone $1)::time >= '10:00' late`, [tz]);
      await db.query(`update profiles set date_of_birth = ((now() at time zone $2)::date + 7) - interval '30 years' where id = $1`, [t2.uid, tz]);
      const fan = await createUser(db, 'BdayFan');
      await buy(fan, 'multi-8');
      await book(fan, await taughtBy(t2.instructorId, 60 * 24 * 3, 'fitdance'));
      await as(db, service, `select queue_member_instructor_birthdays()`);
      await as(db, service, `select queue_member_instructor_birthdays()`);
      const { rows } = await db.query(`select payload->>'phase' phase from notification_outbox where user_id = $1 and kind = 'instructor_birthday_member'`, [fan]);
      expect(rows.map((r) => r.phase)).toEqual(late ? ['week_before'] : []);
    });

    it('linking an account makes that person an instructor', async () => {
      const t = await teacher('Talita');
      const { rows } = await db.query(`select role from profiles where id = $1`, [t.uid]);
      expect(rows[0].role).toBe('instructor');
    });

    it('instructors see the roster of their own classes only', async () => {
      const t = await teacher('Vini');
      const other = await teacher('Alex');
      const mine = await taughtBy(t.instructorId, 600);
      const theirs = await taughtBy(other.instructorId, 600);
      const m = await createUser(db, 'RosterMember');
      await buy(m, 'multi-8');
      await book(m, mine);
      await book(m, theirs);

      const [r] = await as<{ r: { bookings: { full_name: string; kind: string; is_new: boolean }[]; booked_count: number } }>(
        db, user(t.uid), `select staff_roster($1) as r`, [mine]);
      expect(r.r.booked_count).toBe(1);
      expect(r.r.bookings).toHaveLength(1);
      expect(r.r.bookings[0]).toMatchObject({ full_name: 'RosterMember', kind: 'membership' });
      await expectError(as(db, user(t.uid), `select staff_roster($1)`, [theirs]), 'forbidden');
      await expectError(as(db, user(m), `select staff_roster($1)`, [mine]), 'forbidden');

      const visible = await as<{ session_id: string }>(db, user(t.uid), `select session_id from bookings where user_id = $1`, [m]);
      expect(visible.map((b) => b.session_id)).toEqual([mine]);

      const [sessions] = await as<{ r: { id: string; booked_count: number }[] }>(db, user(t.uid),
        `select staff_sessions(now(), now() + interval '2 days') as r`);
      expect(sessions.r.map((x) => x.id)).toEqual([mine]);
      expect(sessions.r[0].booked_count).toBe(1);
    });

    it('marks a member New on their first class at the studio', async () => {
      const t = await teacher('Humberto');
      const first = await taughtBy(t.instructorId, 700, 'reggaeton');
      const second = await taughtBy(t.instructorId, 2000, 'reggaeton');
      const m = await createUser(db, 'Newbie');
      await buy(m, 'multi-5');
      await book(m, first);
      await book(m, second);
      const flag = async (s: string) => ((await as<{ r: { bookings: { is_new: boolean }[] } }>(db, user(t.uid), `select staff_roster($1) as r`, [s]))[0]).r.bookings[0].is_new;
      expect(await flag(first)).toBe(true);
      expect(await flag(second)).toBe(false);
    });

    it('instructors can book a member into their class using the member’s membership', async () => {
      const t = await teacher('Jorginho');
      const s = await taughtBy(t.instructorId, 25 * 24 * 60, 'fitdance'); // beyond the members' 3-week window
      const m = await createUser(db, 'WalkIn', 'customer', { photo: false });
      const { membershipId } = await (async () => {
        await db.query(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1 || '/t.jpg', $1::uuid)`, [m]);
        const r = await buy(m, 'multi-5');
        await db.query(`delete from storage.objects where bucket_id = 'avatars' and owner = $1::uuid`, [m]);
        return r;
      })();
      const [r] = await as<{ r: { booking_id: string; classes_remaining: number } }>(db, user(t.uid), `select staff_book_member($1, $2) as r`, [s, m]);
      expect(r.r.classes_remaining).toBe(4);
      const { rows } = await db.query(`select actor_id from credit_transactions where booking_id = $1`, [r.r.booking_id]);
      expect(rows[0].actor_id).toBe(t.uid);
      expect((await db.query(`select classes_remaining from memberships where id = $1`, [membershipId])).rows[0].classes_remaining).toBe(4);

      const noPack = await createUser(db, 'NoPack');
      await expectError(as(db, user(t.uid), `select staff_book_member($1, $2)`, [s, noPack]), 'no_membership');
      const other = await taughtBy((await teacher('Ana')).instructorId, 900);
      await expectError(as(db, user(t.uid), `select staff_book_member($1, $2)`, [other, m]), 'forbidden');
      const found = await as<{ r: { full_name: string }[] }>(db, user(t.uid), `select staff_find_members('walk') as r`);
      expect(found[0].r.map((x) => x.full_name)).toContain('WalkIn');
      await expectError(as(db, user(m), `select staff_find_members('walk')`), 'forbidden');
    });

    it('instructors can only mark attendance in their own classes', async () => {
      const t = await teacher('Joao');
      const other = await teacher('Outro');
      const theirs = await taughtBy(other.instructorId, 20);
      const m = await createUser(db, 'AttendMember');
      await buy(m, 'multi-5');
      const { booking_id } = await book(m, theirs);
      await expectError(as(db, user(t.uid), `select admin_set_attendance($1, 'attended')`, [booking_id]), 'forbidden');
      await as(db, user(other.uid), `select admin_set_attendance($1, 'attended')`, [booking_id]);
    });

    it('alerts the teacher about a birthday the day before and 10 minutes before class, once each', async () => {
      const t = await teacher('Birthdays');
      const s = await taughtBy(t.instructorId, 5 * 60);
      const m = await createUser(db, 'Party Person');
      await db.query(
        `update profiles set date_of_birth = ((select starts_at from class_sessions where id = $2) at time zone 'Europe/Dublin')::date - interval '30 years' where id = $1`,
        [m, s]);
      await buy(m, 'multi-5');
      await book(m, s);
      const plain = await createUser(db, 'NotToday');
      await db.query(`update profiles set date_of_birth = '1990-01-01' where id = $1`, [plain]);
      await buy(plain, 'multi-5');
      await book(plain, s);

      await as(db, service, `select queue_birthday_alerts()`);
      await as(db, service, `select queue_birthday_alerts()`);
      let { rows } = await db.query(`select payload from notification_outbox where user_id = $1 and kind = 'member_birthday'`, [t.uid]);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toMatchObject({ member_name: 'Party Person', phase: 'day_before', turning: 30 });

      await db.query(`update class_sessions set starts_at = now() + interval '8 minutes', ends_at = now() + interval '68 minutes' where id = $1`, [s]);
      // Keep the birthday on the class's (possibly new) local date, whatever the time of day the suite runs.
      await db.query(
        `update profiles set date_of_birth = ((select starts_at from class_sessions where id = $2) at time zone 'Europe/Dublin')::date - interval '30 years' where id = $1`,
        [m, s]);
      await as(db, service, `select queue_birthday_alerts()`);
      ({ rows } = await db.query(`select payload ->> 'phase' as phase from notification_outbox where user_id = $1 and kind = 'member_birthday' order by id`, [t.uid]));
      expect(rows.map((r) => r.phase)).toEqual(['day_before', 'ten_min']);

      const [r] = await as<{ r: { bookings: { full_name: string; is_birthday: boolean; turning: number | null }[] } }>(db, user(t.uid), `select staff_roster($1) as r`, [s]);
      expect(r.r.bookings.find((b) => b.full_name === 'Party Person')).toMatchObject({ is_birthday: true, turning: 30 });
      expect(r.r.bookings.find((b) => b.full_name === 'NotToday')).toMatchObject({ is_birthday: false, turning: null });
    });
  });

  describe('date of birth', () => {
    it('is taken from the sign-up form and validated', async () => {
      const id = randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'dob@example.com', $2)`,
        [id, { full_name: 'Dob Person', date_of_birth: '1995-06-15' }]);
      expect((await db.query(`select to_char(date_of_birth, 'YYYY-MM-DD') d from profiles where id = $1`, [id])).rows[0].d).toBe('1995-06-15');
      const bad = randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'baddob@example.com', $2)`, [bad, { date_of_birth: 'not a date' }]);
      expect((await db.query(`select date_of_birth from profiles where id = $1`, [bad])).rows[0].date_of_birth).toBeNull();
      await expect(as(db, user(id), `update profiles set date_of_birth = current_date + 1 where id = $1`, [id])).rejects.toThrow(/invalid_date_of_birth/);
      await as(db, user(id), `update profiles set date_of_birth = '1996-06-15' where id = $1`, [id]);
    });
  });

  // ---------------------------------------------------------------- notifications
  describe('monthly memberships (3 monthly payments)', () => {
    let seq = 0;
    async function subscribe(code: string, existing?: string) {
      const c = existing ?? await createUser(db, `Monthly${++seq}`);
      const { paymentId, membershipId } = await buy(c, code);
      const { rows: [sub] } = await db.query(`select id from member_subscriptions where initial_payment_id = $1`, [paymentId]);
      const provider = `sqsub_${randomUUID()}`;
      await as(db, service, `select link_provider_subscription($1, $2, 'CUST1')`, [paymentId, provider]);
      return { c, paymentId, membershipId, subId: sub.id as string, provider };
    }
    const subRow = async (id: string) => (await db.query(
      `select status, end_reason, periods_paid, next_billing_on = _local_date(now()) + interval '1 month' as next_in_a_month,
              next_billing_on is null as no_more_payments, billing_sync_needed, cancel_effective_on
       from member_subscriptions where id = $1`, [id])).rows[0];
    // Make the next payment due today, then Square collects it.
    async function payNext(subId: string, provider: string, amount: number, ref = `inv:${randomUUID()}`) {
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()),
                        cancel_effective_on = case when cancel_effective_on is null then null else _add_month(_local_date(now())) end
                      where id = $1 and next_billing_on is not null`, [subId]);
      const [r] = await as<{ r: Record<string, unknown> }>(db, service,
        `select fulfill_subscription_charge($1, $2, $3, $4, 'EUR') r`, [provider, ref, `evt_${randomUUID()}`, amount]);
      return { ...r.r, ref } as { ok: boolean; duplicate?: boolean; review?: boolean; error?: string; membership_id: string; period_index: number; send_provider_cancel?: boolean; ref: string };
    }
    const open = async (subId: string) =>
      (await db.query(`select id, classes_remaining, classes_total from memberships where subscription_id = $1 and expires_at > now() order by created_at`, [subId])).rows;
    const use = (membershipId: string, n: number) =>
      db.query(`update memberships set classes_remaining = classes_remaining - $2 where id = $1`, [membershipId, n]);

    it('every membership payment queues one email receipt (first month and each monthly payment)', async () => {
      const { c, subId, provider } = await subscribe('multi-8');
      const receipts = async () => (await db.query(
        `select payload->>'plan_name' plan, (payload->>'amount_cents')::int amount, payload->>'month' mon, payload->>'of' of_
         from notification_outbox where user_id = $1 and kind = 'payment_receipt' order by id`, [c])).rows;
      expect(await receipts()).toEqual([{ plan: 'Committed', amount: 7900, mon: '1', of_: '3' }]);
      const m2 = await payNext(subId, provider, 7900);
      await as(db, service, `select fulfill_subscription_charge($1, $2, 'evt_dup', 7900, 'EUR')`, [provider, m2.ref]); // repeated webhook
      expect((await receipts()).map((r) => r.mon)).toEqual(['1', '2']);
      // The Intro Offer (one-off) gets a receipt too; free reward classes don't.
      const one = await createUser(db, 'IntroReceipt');
      await buy(one, 'intro-3');
      expect((await db.query(`select payload->>'month' mon from notification_outbox where user_id = $1 and kind = 'payment_receipt'`, [one])).rows).toEqual([{ mon: null }]);
    });

    it('the Intro Offer stays a one-off purchase with no subscription', async () => {
      const c = await createUser(db, 'IntroOnly');
      const { paymentId } = await buy(c, 'intro-3');
      expect((await db.query(`select count(*)::int n from member_subscriptions where initial_payment_id = $1`, [paymentId])).rows[0].n).toBe(0);
    });

    it('starts with month 1 of 3: classes valid until the next payment date a month later', async () => {
      const { subId, membershipId } = await subscribe('multi-5');
      expect(await subRow(subId)).toMatchObject({ status: 'active', periods_paid: 1, next_in_a_month: true });
      const { rows: [m] } = await db.query(
        `select m.classes_remaining, m.expires_at = _end_of_day(s.next_billing_on) as ends_at_next_payment
         from memberships m join member_subscriptions s on s.id = m.subscription_id where m.id = $1`, [membershipId]);
      expect(m).toEqual({ classes_remaining: 5, ends_at_next_payment: true });
    });

    it('Single Style, Multi-Style, Committed: each month resets the classes; unused ones expire', async () => {
      const { subId, provider, membershipId } = await subscribe('multi-8');
      await use(membershipId, 5); // 3 left
      const m2 = await payNext(subId, provider, 7900);
      expect(m2).toMatchObject({ ok: true, duplicate: false, period_index: 1 });
      expect(await open(subId)).toEqual([{ id: m2.membership_id, classes_remaining: 8, classes_total: 8 }]);
      const { rows: [exp] } = await db.query(`select delta, balance_after from credit_transactions where membership_id = $1 and kind = 'period_expired'`, [membershipId]);
      expect(exp).toEqual({ delta: -3, balance_after: 0 });
      // The same Square payment reported again: nothing new.
      const [again] = await as<{ r: { duplicate: boolean } }>(db, service, `select fulfill_subscription_charge($1, $2, 'evt_x', 7900, 'EUR') r`, [provider, m2.ref]);
      expect(again.r.duplicate).toBe(true);
      expect(await open(subId)).toHaveLength(1);
    });

    it('All In: classes roll over through the 3 months; then the membership ends and anything left expires', async () => {
      const { subId, provider, membershipId } = await subscribe('multi-12');
      const { rows: [m1] } = await db.query(`select expires_at = _end_of_day((_local_date(now()) + interval '3 months')::date) as three_months from memberships where id = $1`, [membershipId]);
      expect(m1.three_months).toBe(true);
      await use(membershipId, 8);                        // month 1: 12 → 4
      expect((await payNext(subId, provider, 9900)).membership_id).toBe(membershipId);
      expect((await open(subId))[0]).toMatchObject({ classes_remaining: 16 });
      await use(membershipId, 10);                       // 6 left
      await payNext(subId, provider, 9900);              // month 3: 18
      expect((await open(subId))[0]).toMatchObject({ id: membershipId, classes_remaining: 18, classes_total: 36 });
      expect(await subRow(subId)).toMatchObject({ periods_paid: 3, no_more_payments: true });
      // Square shouldn't charge again; if it did, the money is flagged, no classes.
      const extra = await as<{ r: { review: boolean; error: string } }>(db, service, `select fulfill_subscription_charge($1, 'inv:extra', 'evt_e', 9900, 'EUR') r`, [provider]);
      expect(extra[0].r).toMatchObject({ review: true, error: 'no_payment_expected' });
      // After the last month the membership ends as completed.
      await db.query(`update member_subscriptions set current_period_ends_on = _local_date(now()) where id = $1`, [subId]);
      await as(db, service, `select queue_subscription_reminders()`);
      expect(await subRow(subId)).toMatchObject({ status: 'ended', end_reason: 'completed' });
    });

    it('the first month reported again as a Square invoice is not a second payment', async () => {
      const { subId, provider } = await subscribe('multi-5');
      const [r] = await as<{ r: { duplicate: boolean } }>(db, service, `select fulfill_subscription_charge($1, 'inv:first', 'evt_f', 5500, 'EUR') r`, [provider]);
      expect(r.r.duplicate).toBe(true);
      expect((await subRow(subId)).periods_paid).toBe(1);
    });

    it('a failed payment issues no classes and tells the member; paying later issues them', async () => {
      const { c, subId, provider } = await subscribe('multi-5');
      await as(db, service, `select subscription_charge_failed($1, 'inv:failed_1')`, [provider]);
      await as(db, service, `select subscription_charge_failed($1, 'inv:failed_1')`, [provider]);
      expect((await subRow(subId)).status).toBe('past_due');
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'subscription_payment_failed'`, [c])).rows[0].n).toBe(1);
      expect((await payNext(subId, provider, 5500)).period_index).toBe(1);
      expect((await subRow(subId)).status).toBe('active');
    });

    it('a wrong amount or an early payment is accepted but flagged, with no classes', async () => {
      const { subId, provider } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()) where id = $1`, [subId]);
      const [wrong] = await as<{ r: { ok: boolean; error: string } }>(db, service, `select fulfill_subscription_charge($1, 'inv:w', 'evt_w', 100, 'EUR') r`, [provider]);
      expect(wrong.r).toMatchObject({ ok: false, error: 'amount_mismatch' });
      expect((await subRow(subId)).periods_paid).toBe(1);
      expect((await payNext(subId, provider, 5500)).period_index).toBe(1);
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()) + 10 where id = $1`, [subId]);
      const [early] = await as<{ r: { error: string } }>(db, service, `select fulfill_subscription_charge($1, 'inv:early', 'evt_early', 5500, 'EUR') r`, [provider]);
      expect(early.r.error).toBe('early_payment');
    });

    it('cancelling at least 72 hours before the next payment: no more payments, no penalty', async () => {
      const { c, subId } = await subscribe('multi-5');
      const [r] = await as<{ r: { payments_left: number; send_provider_cancel: boolean } }>(db, user(c), `select request_subscription_cancel($1) r`, [subId]);
      expect(r.r).toMatchObject({ payments_left: 0, send_provider_cancel: true });
      expect(await subRow(subId)).toMatchObject({ status: 'cancel_scheduled', no_more_payments: true });
      // Changed their mind before it reached Square: payments continue.
      await as(db, user(c), `select undo_subscription_cancel($1)`, [subId]);
      expect(await subRow(subId)).toMatchObject({ status: 'active', next_in_a_month: true });
      await as(db, user(c), `select request_subscription_cancel($1)`, [subId]);
      await as(db, service, `select mark_provider_cancel_sent($1)`, [subId]);
      await expectError(as(db, user(c), `select undo_subscription_cancel($1)`, [subId]), 'cancel_already_processed');
      const other = await createUser(db, 'Nosy');
      await expectError(as(db, user(other), `select request_subscription_cancel($1)`, [subId]), 'subscription_not_found');
    });

    it('cancelling less than 72 hours before: that payment is still taken, then it ends', async () => {
      const { c, subId, provider } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()) + 2 where id = $1`, [subId]);
      const [r] = await as<{ r: { payments_left: number; send_provider_cancel: boolean } }>(db, user(c), `select request_subscription_cancel($1) r`, [subId]);
      expect(r.r).toMatchObject({ payments_left: 1, send_provider_cancel: false });
      const paid = await payNext(subId, provider, 5500);
      expect(paid.send_provider_cancel).toBe(true);
      expect(await subRow(subId)).toMatchObject({ periods_paid: 2, no_more_payments: true });
    });

    it('admins can stop a membership at the next payment date, with a reason', async () => {
      const { c, subId } = await subscribe('multi-8');
      await expectError(as(db, user(c), `select admin_end_subscription_now($1, 'x')`, [subId]), 'forbidden');
      const [r] = await as<{ r: { send_provider_cancel: boolean } }>(db, user(admin), `select admin_end_subscription_now($1, 'Moving abroad') r`, [subId]);
      expect(r.r.send_provider_cancel).toBe(true);
      expect(await subRow(subId)).toMatchObject({ status: 'cancel_scheduled', no_more_payments: true });
    });

    it('pausing moves the next payment date back by the paused days (and back again if ended early)', async () => {
      const { c, subId, membershipId } = await subscribe('multi-5');
      const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
      const before = (await db.query(`select next_billing_on::text d from member_subscriptions where id = $1`, [subId])).rows[0].d as string;
      await as(db, user(c), `select pause_membership($1, $2::date, $3::date)`, [membershipId, day(2), day(8)]); // 7 days
      const { rows: [after] } = await db.query(`select (next_billing_on - $2::date) as moved, billing_sync_needed from member_subscriptions where id = $1`, [subId, before]);
      expect(after).toEqual({ moved: 7, billing_sync_needed: true });
      // The pause hasn't started, so ending it removes it and the date moves back.
      await as(db, user(c), `select resume_membership($1)`, [membershipId]);
      expect((await db.query(`select next_billing_on::text d from member_subscriptions where id = $1`, [subId])).rows[0].d).toBe(before);
      // A pause can't start after the next payment.
      await expect(as(db, user(c), `select pause_membership($1, $2::date, $3::date)`, [membershipId, day(40), day(47)])).rejects.toThrow(/pause_after_next_payment|pause_after_expiry/);
    });

    it('paused: Square is stopped for the paid month, restarted on the new date, and billing carries on', async () => {
      const { subId, provider } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set billing_sync_needed = true where id = $1`, [subId]);
      await as(db, service, `select mark_billing_synced($1)`, [subId]); // Square subscription stopped
      // The stopped Square subscription ends: the membership itself carries on.
      await as(db, service, `select subscription_provider_ended($1, 'CANCELED')`, [provider]);
      expect((await subRow(subId)).status).toBe('active');
      // Not due yet → nothing to restart; on the new payment date → due.
      expect((await as(db, service, `select * from subscriptions_due_restart() where subscription_id = $1`, [subId]))).toHaveLength(0);
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()) where id = $1`, [subId]);
      const [due] = await as<{ payments_left: number }>(db, service, `select * from subscriptions_due_restart() where subscription_id = $1`, [subId]);
      expect(due.payments_left).toBe(2);
      const fresh = `sqsub_${randomUUID()}`;
      await as(db, service, `select replace_provider_subscription($1, $2)`, [subId, fresh]);
      const [r] = await as<{ r: { period_index: number } }>(db, service, `select fulfill_subscription_charge($1, 'inv:after-pause', 'evt_ap', 5500, 'EUR') r`, [fresh]);
      expect(r.r.period_index).toBe(1);
      await expect(as(db, user(admin), `select * from subscriptions_due_restart()`)).rejects.toThrow(/permission denied/);
    });

    it('upgrade: once the classes run out, a member can move to a dearer plan; the old one stops', async () => {
      const { c, subId, membershipId } = await subscribe('multi-5');
      const tryCheckout = async (planUuid: string, style: string | null = null) =>
        as(db, user(c), `select create_checkout($1, $2, $3, 'square')`, [planUuid, style ? await styleId(style) : null, randomUUID()]);
      await expectError(tryCheckout(await planId('multi-8')), 'already_subscribed'); // still has classes
      await use(membershipId, 5);
      await expectError(tryCheckout(await planId('single-4'), 'heels'), 'already_subscribed'); // not an upgrade
      const up = await subscribe('multi-8', c);
      const { rows: [old] } = await db.query(`select status, end_reason, upgraded_to from member_subscriptions where id = $1`, [subId]);
      expect(old).toEqual({ status: 'ended', end_reason: 'upgraded', upgraded_to: up.subId });
      expect(await open(up.subId)).toEqual([expect.objectContaining({ classes_remaining: 8 })]);
    });

    it('loyalty reward: completing all 3 payments and signing up again gives 3 free classes for 7 days, once', async () => {
      const { c, subId } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set periods_paid = 3, next_billing_on = null, status = 'ended', end_reason = 'completed' where id = $1`, [subId]);
      const again = await subscribe('multi-8', c);
      const { rows: rewards } = await db.query(
        `select classes_remaining, style_access, plan_name, public._local_date(expires_at) - public._local_date(now()) as days
         from memberships where user_id = $1 and plan_name like 'Loyalty reward%'`, [c]);
      expect(rewards).toEqual([{ classes_remaining: 3, style_access: 'multi', plan_name: 'Loyalty reward · 3 free classes', days: 8 }]);
      expect((await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'loyalty_reward'`, [c])).rows[0].n).toBe(1);
      expect((await db.query(`select count(*)::int n from credit_transactions where user_id = $1 and kind = 'grant_reward'`, [c])).rows[0].n).toBe(1);
      // Not again for the same completed membership.
      await db.query(`update member_subscriptions set status = 'ended', end_reason = 'cancelled', periods_paid = 1 where id = $1`, [again.subId]);
      await subscribe('multi-5', c);
      expect((await db.query(`select count(*)::int n from memberships where user_id = $1 and plan_name like 'Loyalty reward%'`, [c])).rows[0].n).toBe(1);
    });

    it('the reward comes every time a member completes 3 months and signs up again, and its classes can be booked', async () => {
      const { c, subId } = await subscribe('multi-5');
      const complete = (id: string) => db.query(`update member_subscriptions set periods_paid = 3, next_billing_on = null, status = 'ended', end_reason = 'completed' where id = $1`, [id]);
      const rewards = async () => (await db.query(`select id, classes_remaining from memberships where user_id = $1 and plan_name like 'Loyalty reward%' order by created_at`, [c])).rows;
      await complete(subId);
      const second = await subscribe('multi-5', c);
      expect(await rewards()).toHaveLength(1);
      await complete(second.subId);
      await subscribe('multi-8', c);
      const all = await rewards();
      expect(all.map((r) => r.classes_remaining)).toEqual([3, 3]);
      // The reward classes really work: book a class with them.
      const s = await makeSession({ style: 'heels', startsInMinutes: 24 * 60 });
      const r = await book(c, s, all[1].id);
      expect(r.classes_remaining).toBe(2);
      expect((await db.query(`select balance_after from credit_transactions where membership_id = $1 and kind = 'booking'`, [all[1].id])).rows[0].balance_after).toBe(2);
    });

    it('no reward for a membership cancelled before its 3 payments', async () => {
      const { c, subId } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set status = 'ended', end_reason = 'cancelled' where id = $1`, [subId]);
      await subscribe('multi-5', c);
      expect((await db.query(`select count(*)::int n from memberships where user_id = $1 and plan_name like 'Loyalty reward%'`, [c])).rows[0].n).toBe(0);
    });

    it('reminds before each payment and before the end', async () => {
      const { c, subId } = await subscribe('multi-5');
      await db.query(`update member_subscriptions set next_billing_on = _local_date(now()) + 3 where id = $1`, [subId]);
      await as(db, service, `select queue_subscription_reminders()`);
      await as(db, service, `select queue_subscription_reminders()`);
      await db.query(`update member_subscriptions set periods_paid = 3, next_billing_on = null, current_period_ends_on = _local_date(now()) + 5 where id = $1`, [subId]);
      await as(db, service, `select queue_subscription_reminders()`);
      const { rows } = await db.query(`select kind, payload->>'reward' reward from notification_outbox where user_id = $1 and kind like 'subscription_%' order by id`, [c]);
      expect(rows).toEqual([{ kind: 'subscription_renewing', reward: null }, { kind: 'subscription_ending', reward: 'true' }]);
      await expect(as(db, user(c), `select queue_subscription_reminders()`)).rejects.toThrow(/permission denied/);
    });

    it('refunds are for admins only', async () => {
      const { c, paymentId } = await subscribe('multi-5');
      await expectError(as(db, user(c), `select admin_can_refund($1)`, [paymentId]), 'forbidden');
      const [r] = await as<{ r: { amount_cents: number } }>(db, user(admin), `select admin_can_refund($1) r`, [paymentId]);
      expect(r.r.amount_cents).toBe(5500);
    });

    it('members only see their own subscriptions', async () => {
      const { c, subId } = await subscribe('multi-5');
      const other = await createUser(db, 'Peeker');
      expect(await as(db, user(c), `select id from member_subscriptions where id = $1`, [subId])).toHaveLength(1);
      expect(await as(db, user(other), `select id from member_subscriptions where id = $1`, [subId])).toHaveLength(0);
      await expect(as(db, user(c), `select fulfill_subscription_charge('x', 'y', 'z', 1, 'EUR')`)).rejects.toThrow(/permission denied/);
    });
  });

  describe('notifications', () => {
    it('the admin Today page has the numbers, for admins only', async () => {
      const [d] = await as<{ r: Record<string, number> }>(db, user(admin), `select admin_dashboard() r`);
      expect(Object.keys(d.r).sort()).toEqual(['active_monthly', 'bookings_today', 'ending_monthly', 'failed_monthly_payments', 'finance', 'new_members_week',
        'payments_to_review', 'payments_week', 'revenue_week_cents', 'ticket_refunds', 'unfinished_checkouts']);
      const c = await createUser(db, 'NotAdminDash');
      await expectError(as(db, user(c), `select admin_dashboard()`), 'forbidden');
    });

    it('admins can change a class; everyone booked is told what changed', async () => {
      const c = await createUser(db, 'MovedClass');
      await buy(c, 'intro-3');
      const s = await makeSession({ style: 'heels', startsInMinutes: 600 });
      await book(c, s);
      const { rows: [inst] } = await db.query(`insert into instructors (full_name) values ('Substitute Teacher') returning id`);
      const later = new Date(Date.now() + 660 * 60_000).toISOString();
      const end = new Date(Date.now() + 720 * 60_000).toISOString();
      await expectError(as(db, user(c), `select admin_update_session($1, $2, $3, $4, 'Heels', null)`, [s, later, end, inst.id]), 'forbidden');
      const [r] = await as<{ r: { notified: number } }>(db, user(admin), `select admin_update_session($1, $2, $3, $4, 'Heels', 'Sorry for the change!') r`, [s, later, end, inst.id]);
      expect(r.r.notified).toBe(1);
      const { rows: [n] } = await db.query(`select payload from notification_outbox where user_id = $1 and kind = 'class_changed'`, [c]);
      expect(n.payload).toMatchObject({ time_changed: true, instructor_changed: true, instructor: 'Substitute Teacher', note: 'Sorry for the change!' });
      // The booking stays.
      expect((await db.query(`select status from bookings where session_id = $1 and user_id = $2`, [s, c])).rows[0].status).toBe('booked');
      await expectError(as(db, user(admin), `select admin_update_session($1, $2, $2, $3, 'Heels', null)`, [s, later, inst.id]), 'invalid_session_times');
    });

    it('are on by default; a member who turns email off gets none', async () => {
      const id = randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'quiet@example.com', $2)`, [id, { full_name: 'Quiet One' }]);
      expect((await db.query(`select notify_email, notify_push from profiles where id = $1`, [id])).rows[0]).toEqual({ notify_email: true, notify_push: true });
      const off = randomUUID();
      await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'nonotify@example.com', $2)`, [off, { notifications: false }]);
      expect((await db.query(`select notify_email, notify_push from profiles where id = $1`, [off])).rows[0]).toEqual({ notify_email: false, notify_push: false });
      // The member can change it themselves.
      await as(db, user(id), `update profiles set notify_email = false where id = $1`, [id]);
      await db.query(`insert into notification_outbox (user_id, kind, payload) values ($1, 'test_message', '{}')`, [id]);
      const claimed = await as<{ user_id: string; email: string | null }>(db, service, `select user_id, email from claim_notifications(500)`);
      expect(claimed.find((r) => r.user_id === id)?.email).toBeNull();
      // Leave the outbox as the next tests expect.
      await db.query(`delete from notification_outbox where user_id = $1`, [id]);
      await db.query(`update notification_outbox set claimed_at = null, attempts = 0 where sent_at is null`);
    });

    it('studio cancellations queue a notification per booked customer', async () => {
      const c = await createUser(db, 'Notified');
      await buy(c, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 300 });
      await book(c, s);
      await as(db, user(admin), `select admin_cancel_session($1, 'Studio flooded')`, [s]);
      const { rows } = await db.query(`select kind, payload from notification_outbox where user_id = $1 and kind = 'class_cancelled'`, [c]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ kind: 'class_cancelled', payload: { reason: 'Studio flooded', class_returned: true } });
    });

    it('expiry reminders are queued once when enabled', async () => {
      const c = await createUser(db, 'Expiring');
      const { membershipId } = await buy(c, 'multi-5');
      await db.query(`update memberships set expires_at = now() + interval '2 days' where id = $1`, [membershipId]);
      await db.query(`update app_settings set expiry_reminders_enabled = true`);
      try {
        await as(db, service, `select queue_expiry_reminders()`);
        await as(db, service, `select queue_expiry_reminders()`);
      } finally {
        await db.query(`update app_settings set expiry_reminders_enabled = false`);
      }
      const { rows } = await db.query(`select count(*)::int n from notification_outbox where user_id = $1 and kind = 'membership_expiring'`, [c]);
      expect(rows[0].n).toBe(1);
    });

    it('delivery claims each message once and records the outcome', async () => {
      const claim = () => as<{ id: number; email: string }>(db, service, `select * from claim_notifications(500)`);
      const first = await claim();
      expect(first.length).toBeGreaterThanOrEqual(2);
      expect(first.every((r) => r.email.endsWith('@example.com'))).toBe(true);
      expect(await claim()).toHaveLength(0); // already claimed
      await as(db, service, `select complete_notification($1)`, [first[0].id]);
      await as(db, service, `select complete_notification($1, 'smtp down')`, [first[1].id]);
      const outcome = async (id: number) => (await db.query(`select sent_at is not null sent, error from notification_outbox where id = $1`, [id])).rows[0];
      expect(await outcome(first[0].id)).toMatchObject({ sent: true, error: null });
      expect(await outcome(first[1].id)).toMatchObject({ sent: false, error: 'smtp down' });
      const retry = await claim(); // failed one is claimable again
      expect(retry.map((r) => Number(r.id))).toContain(Number(first[1].id));
      await expect(as(db, user(admin), `select * from claim_notifications(10)`)).rejects.toThrow(/permission denied/);
    });
  });

  // ---------------------------------------------------------------- admin
  describe('administration', () => {
    it('grants and revokes classes with a reason and audit trail', async () => {
      const c = await createUser(db, 'Adjusted');
      const { membershipId } = await buy(c, 'multi-5');
      await expectError(as(db, user(admin), `select admin_adjust_classes($1, 2, '  ')`, [membershipId]), 'reason_required');
      await as(db, user(admin), `select admin_adjust_classes($1, 2, 'Class cancelled last week')`, [membershipId]);
      await as(db, user(admin), `select admin_adjust_classes($1, -1, 'Correction')`, [membershipId]);
      expect(await remaining(membershipId)).toBe(6);
      await expectError(as(db, user(admin), `select admin_adjust_classes($1, -50, 'Too many')`, [membershipId]), 'insufficient_classes');
      const { rows } = await db.query(`select kind, delta, reason from credit_transactions where membership_id = $1 order by id`, [membershipId]);
      expect(rows.slice(1)).toEqual([
        { kind: 'admin_grant', delta: 2, reason: 'Class cancelled last week' },
        { kind: 'admin_revoke', delta: -1, reason: 'Correction' },
      ]);
    });

    it('cancelling a class refunds every booking', async () => {
      const a = await createUser(db, 'Refund1');
      const b = await createUser(db, 'Refund2');
      const ma = (await buy(a, 'multi-5')).membershipId;
      const mb = (await buy(b, 'multi-5')).membershipId;
      const s = await makeSession({ style: 'heels', startsInMinutes: 10 });
      await book(a, s);
      await book(b, s);
      const [r] = await as<{ n: number }>(db, user(admin), `select admin_cancel_session($1, 'Instructor ill') as n`, [s]);
      expect(r.n).toBe(2);
      expect(await remaining(ma)).toBe(5);
      expect(await remaining(mb)).toBe(5);
    });

    it('generates sessions from the weekly timetable in Dublin time', async () => {
      await db.query(
        `insert into class_templates (title, style_id, weekday, start_time, valid_from)
         values ('Gen Test', $1, 3, '19:30', '2026-01-01')`, [await styleId('commercial')],
      );
      const [r] = await as<{ n: number }>(db, user(admin), `select admin_generate_sessions('2026-07-01', '2026-07-07') as n`);
      expect(r.n).toBeGreaterThanOrEqual(1);
      const { rows } = await db.query(
        `select to_char(starts_at at time zone 'Europe/Dublin', 'Dy HH24:MI') l, to_char(starts_at at time zone 'UTC', 'HH24:MI') utc
         from class_sessions where title = 'Gen Test'`,
      );
      expect(rows).toEqual([{ l: 'Wed 19:30', utc: '18:30' }]); // IST (UTC+1) in July
      const [again] = await as<{ n: number }>(db, user(admin), `select admin_generate_sessions('2026-07-01', '2026-07-07') as n`);
      expect(again.n).toBe(0);
    });

    it('analytics count real revenue only and report missing data as null', async () => {
      const real = await createUser(db, 'RealPayer');
      const test = await createUser(db, 'TestPayer');
      await buy(real, 'multi-12');
      await buy(test, 'multi-12', undefined, 'dev_test');
      const [r] = await as<{ a: Record<string, unknown> }>(db, user(admin), `select admin_analytics(current_date, current_date) as a`);
      const a = r.a as { revenue_cents: number; test_payments_excluded: number; revenue_per_attended_class_cents: number | null; sales_by_plan: { plan_code: string; revenue_cents: number }[] };
      expect(a.test_payments_excluded).toBeGreaterThanOrEqual(1);
      const totalReal = (await db.query(`select sum(amount_cents)::int s from payments where status='succeeded' and not is_test and completed_at::date = current_date`)).rows[0].s;
      expect(a.revenue_cents).toBe(totalReal);
      expect(a.revenue_per_attended_class_cents).toBeNull(); // nobody marked attended yet
    });
  });
});
