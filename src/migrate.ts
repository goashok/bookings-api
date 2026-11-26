// Applies the SQL files in migrations/ in name order, each once, recording them in
// schema_migrations. Run it with `npm run migrate` (DATABASE_URL), or call `migrate(db)`.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postgres, type Db } from './db.ts';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

export async function migrate(db: Db): Promise<string[]> {
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const applied: string[] = [];
  for (const name of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    const sql = readFileSync(DIR + name, 'utf8');
    await db.transaction(async (tx) => {
      await tx.query(sql);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    applied.push(name);
  }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const db = postgres(url);
  const applied = await migrate(db);
  console.log(applied.length ? `applied ${applied.join(', ')}` : 'nothing to apply');
  await db.close();
}
