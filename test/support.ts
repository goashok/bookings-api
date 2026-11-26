// The API on PGlite, an in-process PostgreSQL, with a clock the test sets. One database per test
// file, emptied before each test. With TEST_DATABASE_URL set, on that PostgreSQL instead (one at a
// time: `vitest run --no-file-parallelism`), where requests really run side by side.

import { PGlite, type Transaction } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.ts';
import { postgres, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

function wrap(on: PGlite | Transaction): Db {
  const db: Db = {
    async query<R>(sql: string, params?: unknown[]) {
      if (params?.length) return { rows: (await on.query<R>(sql, params)).rows };
      // Without parameters a query may hold several statements, as a migration does.
      const results = await on.exec(sql);
      return { rows: (results.at(-1)?.rows ?? []) as R[] };
    },
    transaction: (fn) => ('transaction' in on ? on.transaction((tx) => fn(wrap(tx))) : fn(db)),
    close: async () => undefined,
  };
  return db;
}

/** Monday 23 November 2026, 09:00 UTC, unless a test moves it. */
export const NOW = new Date('2026-11-23T09:00:00Z');

export function setup() {
  const url = process.env.TEST_DATABASE_URL;
  const pg = url ? undefined : new PGlite();
  const base = pg ? wrap(pg) : postgres(url!);
  // `latency.ms` delays every query inside a transaction, as a slow network would, so that
  // requests racing for the same time really overlap.
  const latency = { ms: 0 };
  const db: Db = {
    query: (sql, params) => base.query(sql, params),
    transaction: (fn) => base.transaction((tx) => fn({ ...tx, query: async (sql, params) => (latency.ms && (await new Promise((r) => setTimeout(r, latency.ms))), tx.query(sql, params)) })),
    close: () => base.close(),
  };
  const clock = { now: NOW };
  const app = buildApp({ db, now: () => clock.now });
  // Starting PGlite (compiling PostgreSQL to run in the process) can take several seconds on a
  // slow machine: it happens here, once, with room to spare, not inside the first test's time.
  beforeAll(() => migrate(db), 60_000);
  beforeEach(async () => {
    await db.query('TRUNCATE venues, resources, bookings CASCADE');
    clock.now = NOW;
    latency.ms = 0;
  });
  afterAll(async () => {
    await app.close();
    await (pg ? pg.close() : base.close());
  });

  const call = async (method: 'GET' | 'POST', url: string, body?: unknown) => {
    const res = await app.inject({ method, url, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }) });
    return { status: res.statusCode, body: res.json() as Record<string, any> };
  };

  /** A venue in London open 12:00 to 23:00, with a table for four. */
  const venueWithTable = async (venue: Record<string, unknown> = {}) => {
    const v = await call('POST', '/venues', { name: 'The Anchor', timeZone: 'Europe/London', opensAt: '12:00', closesAt: '23:00', ...venue });
    if (v.status !== 201) throw new Error(`venue: ${JSON.stringify(v.body)}`);
    const t = await call('POST', `/venues/${v.body.id}/resources`, { name: 'Table 1', capacity: 4 });
    return { venue: v.body, table: t.body };
  };

  const book = (resourceId: string, startsAt: string, endsAt: string, extra: Record<string, unknown> = {}) =>
    call('POST', '/bookings', { resourceId, guestName: 'Ada Lovelace', guestEmail: 'ada@example.com', partySize: 2, startsAt, endsAt, ...extra });

  return { db, app, clock, latency, call, venueWithTable, book, onPostgres: !pg };
}
