import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Applies the real migrations to a throwaway database and lets tests act as
// Supabase roles (anon / authenticated user / service_role).
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? '';

const root = join(import.meta.dirname, '..');

export async function createTestDatabase() {
  const name = `drop_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const connectionString = url.toString();

  const db = new pg.Client({ connectionString });
  await db.connect();
  await db.query(readFileSync(join(root, 'tests/supabase_shim.sql'), 'utf8'));
  const migrations = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    try {
      await db.query(readFileSync(join(root, 'migrations', file), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  return {
    name,
    connectionString,
    db,
    async drop() {
      await db.end();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export type Role = { kind: 'anon' } | { kind: 'user'; id: string } | { kind: 'service' };

/** Run `sql` in its own transaction as the given Supabase role. */
export async function as<T = Record<string, unknown>>(
  client: pg.Client,
  role: Role,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  await client.query('begin');
  try {
    if (role.kind === 'anon') {
      await client.query('set local role anon');
    } else if (role.kind === 'service') {
      await client.query('set local role service_role');
    } else {
      await client.query('set local role authenticated');
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [role.id]);
    }
    const res = await client.query(sql, params);
    await client.query('commit');
    return res.rows as T[];
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

export async function createUser(
  db: pg.Client,
  name: string,
  role: 'customer' | 'admin' | 'instructor' = 'customer',
  opts: { photo?: boolean; phone?: string | null } = {},
) {
  const id = randomUUID();
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${name.toLowerCase()}@example.com`,
    { full_name: name },
  ]);
  if (role !== 'customer') await db.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
  // Paying needs a mobile number; give each test user a unique one unless told otherwise.
  const phone = opts.phone === undefined ? `08${String(parseInt(id.replace(/-/g, '').slice(0, 8), 16) % 100000000).padStart(8, '0')}` : opts.phone;
  if (phone) await db.query(`update public.profiles set phone = $2 where id = $1`, [id, phone]);
  // Booking requires a profile photo; most tests start from a customer who has one.
  if (opts.photo !== false) {
    await db.query(`insert into storage.objects (bucket_id, name, owner) values ('avatars', $1 || '/photo.jpg', $1::uuid)`, [id]);
    await db.query(`update public.profiles set avatar_path = $1 || '/photo.jpg' where id = $1::uuid`, [id]);
  }
  return id;
}

export const user = (id: string): Role => ({ kind: 'user', id });
export const service: Role = { kind: 'service' };
export const anon: Role = { kind: 'anon' };

export async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== code) throw new Error(`Expected error "${code}" but got "${msg}"`);
    return;
  }
  throw new Error(`Expected error "${code}" but the call succeeded`);
}
