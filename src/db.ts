// The database, as the rest of the code sees it: queries and transactions. In production it is
// PostgreSQL through `pg`; the tests run the same SQL on PGlite, an in-process PostgreSQL.

import pg from 'pg';

export interface Db {
  query<R = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
  /** Runs `fn` in one transaction: committed when it returns, rolled back when it throws. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Without parameters, a query may hold several statements (a migration file); its rows are the last one's. */
async function run<R>(on: pg.Pool | pg.PoolClient, sql: string, params: unknown[] | undefined): Promise<{ rows: R[] }> {
  const r = (params?.length ? await on.query(sql, params) : await on.query(sql)) as pg.QueryResult | pg.QueryResult[];
  return { rows: (Array.isArray(r) ? (r.at(-1)?.rows ?? []) : r.rows) as R[] };
}

export function postgres(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: <R>(sql: string, params?: unknown[]) => run<R>(pool, sql, params),
    async transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      const tx: Db = {
        query: <R>(sql: string, params?: unknown[]) => run<R>(client, sql, params),
        transaction: (inner) => inner(tx),
        close: async () => undefined,
      };
      try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
