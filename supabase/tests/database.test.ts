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
        '2 18:30 FitDance Special (FitDance, Ground Floor Studio, João Zublin, 30)',
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
      expect(m).toEqual({ classes_total: 5, classes_remaining: 5, price_cents: 5500, validity_days: 28, class_count: 5 });
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

    it('refuses tickets for normal classes or workshops without a price', async () => {
      const c = await createUser(db, 'NoTicket');
      await expectError(startTicket(c, await makeSession({ style: 'heels', startsInMinutes: 600 })), 'tickets_not_available');
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

  // ---------------------------------------------------------------- notifications
  describe('notifications', () => {
    it('studio cancellations queue a notification per booked customer', async () => {
      const c = await createUser(db, 'Notified');
      await buy(c, 'multi-5');
      const s = await makeSession({ style: 'heels', startsInMinutes: 300 });
      await book(c, s);
      await as(db, user(admin), `select admin_cancel_session($1, 'Studio flooded')`, [s]);
      const { rows } = await db.query(`select kind, payload from notification_outbox where user_id = $1`, [c]);
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
      const { rows } = await db.query(`select id, sent_at is not null sent, error from notification_outbox where id = any($1) order by id`, [[first[0].id, first[1].id]]);
      expect(rows[0]).toMatchObject({ sent: true, error: null });
      expect(rows[1]).toMatchObject({ sent: false, error: 'smtp down' });
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
