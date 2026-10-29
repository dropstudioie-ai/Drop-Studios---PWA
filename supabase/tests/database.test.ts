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

  async function buy(uid: string, code: string, style?: string, provider: 'stripe' | 'dev_test' = 'stripe') {
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
        `select code, name, display_label, price_cents, currency, class_count, validity_days, style_access, first_time_only
         from membership_plans order by sort_order`,
      );
      expect(rows).toEqual([
        { code: 'intro-3', name: '3-Class Intro', display_label: 'Intro Offer', price_cents: 3500, currency: 'EUR', class_count: 3, validity_days: 21, style_access: 'multi', first_time_only: true },
        { code: 'single-4', name: '4-Class Single Style', display_label: null, price_cents: 4900, currency: 'EUR', class_count: 4, validity_days: 28, style_access: 'single', first_time_only: false },
        { code: 'multi-5', name: '5-Class Multi-Style', display_label: null, price_cents: 5500, currency: 'EUR', class_count: 5, validity_days: 28, style_access: 'multi', first_time_only: false },
        { code: 'multi-8', name: '8-Class Multi-Style', display_label: null, price_cents: 7900, currency: 'EUR', class_count: 8, validity_days: 28, style_access: 'multi', first_time_only: false },
        { code: 'multi-12', name: '12-Class Multi-Style', display_label: null, price_cents: 9900, currency: 'EUR', class_count: 12, validity_days: 56, style_access: 'multi', first_time_only: false },
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
      expect(m).toEqual({ classes_total: 5, classes_remaining: 5, price_cents: 5500, validity_days: 28, class_count: 5 });
    });

    it('fulfilment is idempotent: repeated webhooks grant classes once', async () => {
      const c = await createUser(db, 'DoubleWebhook');
      const [checkout] = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [await planId('multi-8'), randomUUID()]);
      const call = () =>
        as<{ r: { membership_id: string; duplicate: boolean } }>(db, service, `select fulfill_payment($1, 'stripe', 'pi_x', $2, 7900, 'eur') as r`, [checkout.r.payment_id, `evt_${randomUUID()}`]);
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
      const [res] = await as<{ r: { ok: boolean; error: string } }>(db, service, `select fulfill_payment($1, 'stripe', 'pi', 'evt_mm', 100, 'EUR') as r`, [checkout.r.payment_id]);
      expect(res.r).toEqual({ ok: false, error: 'amount_mismatch' });
      const { rows } = await db.query(`select count(*)::int n from memberships where user_id = $1`, [c]);
      expect(rows[0].n).toBe(0);
    });

    it('customers cannot fulfil payments or write memberships directly', async () => {
      const c = await createUser(db, 'Sneaky');
      const [checkout] = await as<{ r: { payment_id: string } }>(db, user(c), `select create_checkout($1, null, $2) as r`, [await planId('multi-12'), randomUUID()]);
      await expect(as(db, user(c), `select fulfill_payment($1, 'stripe', 'x', 'y', 9900, 'EUR')`, [checkout.r.payment_id])).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `update memberships set classes_remaining = 99`)).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `update profiles set role = 'admin' where id = $1`, [c])).rejects.toThrow(/permission denied/);
      await expect(as(db, user(c), `insert into bookings (user_id, session_id) values ($1, $1)`, [c])).rejects.toThrow(/permission denied/);
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
      const { membershipId } = await buy(c, 'multi-5');
      const [m] = (await db.query(
        `select (activated_at at time zone 'Europe/Dublin')::date as act,
                (expires_at at time zone 'Europe/Dublin') as exp
         from memberships where id = $1`, [membershipId],
      )).rows;
      const act = new Date(m.act);
      const exp = new Date(m.exp);
      expect(Math.round((exp.getTime() - act.getTime()) / 86_400_000)).toBe(29); // midnight after day 28
      expect(exp.getHours()).toBe(0);
    });

    it('activation on first booking when configured', async () => {
      await db.query(`update app_settings set activation_policy = 'on_first_booking'`);
      try {
        const c = await createUser(db, 'LateActivation');
        const { membershipId } = await buy(c, 'multi-5');
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
      const { membershipId } = await buy(c, 'multi-5');
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
      const { membershipId } = await buy(c, 'multi-5');
      await as(db, user(c), `select pause_membership($1, current_date, current_date + 10)`, [membershipId]);
      const [st] = await as<{ s: string }>(db, user(c), `select state(m) s from memberships m where id = $1`, [membershipId]);
      expect(st.s).toBe('paused');
      await expectError(book(c, await makeSession({ style: 'heels', startsInMinutes: 12 * 24 * 60 })), 'membership_paused');
    });

    it('limits pauses to 90 days per calendar year', async () => {
      const c = await createUser(db, 'LongPause');
      const { membershipId } = await buy(c, 'multi-12');
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
      const { membershipId } = await buy(c, 'multi-5');
      await book(c, await makeSession({ style: 'heels', startsInMinutes: 3 * 24 * 60 }));
      await expectError(
        as(db, user(c), `select pause_membership($1, current_date + 1, current_date + 10)`, [membershipId]),
        'bookings_during_pause',
      );
    });

    it('admins can pause past the limits and resume, all audited', async () => {
      const c = await createUser(db, 'AdminPaused');
      const { membershipId } = await buy(c, 'multi-5');
      await as(db, user(admin), `select pause_membership($1, current_date, current_date + 1, 'Injury', true)`, [membershipId]);
      await as(db, user(admin), `select resume_membership($1, 'Back early')`, [membershipId]);
      const { rows } = await db.query(
        `select action from audit_log where entity_id = $1 and action like 'membership_%' order by id`, [membershipId],
      );
      expect(rows.map((r) => r.action)).toEqual(['membership_created', 'membership_paused', 'membership_resumed']);
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
