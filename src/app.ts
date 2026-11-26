// The HTTP API. `buildApp` takes its database and clock, so the tests run it against an
// in-process database and a fixed time; main.ts runs it against PostgreSQL.

import Fastify, { type FastifyInstance } from 'fastify';
import { bookingRoutes } from './bookings.ts';
import type { Db } from './db.ts';
import { ApiError } from './errors.ts';
import { venueRoutes } from './venues.ts';

export interface AppOptions {
  db: Db;
  now?: () => Date;
  logger?: boolean;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const now = options.now ?? (() => new Date());

  // Every error answers `{ error, message }`: a code a client can test for, and words a person can read.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ error: error.code, message: error.message });
    const e = error as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: 'invalid_request', message: e.message });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: 'invalid_request', message: e.message });
    req.log.error(error);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on our side.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' }));

  app.get('/health', async () => {
    await options.db.query('SELECT 1');
    return { ok: true };
  });
  venueRoutes(app, options.db);
  bookingRoutes(app, options.db, { now });
  return app;
}
