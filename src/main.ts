// Runs the API: `DATABASE_URL=postgres://… npm start`. Applies any new migrations first.

import { buildApp } from './app.ts';
import { postgres } from './db.ts';
import { migrate } from './migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = postgres(url);
await migrate(db);
const app = buildApp({ db, logger: true });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: process.env.HOST ?? '0.0.0.0' });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void app.close().then(() => db.close()).then(() => process.exit(0)));
}
