// Venues and their resources: the tables, rooms or courts people book.

import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { notFound, ruleBroken } from './errors.ts';
import { formatTime, isTimeZone, parseTime } from './time.ts';

export interface Venue {
  id: string;
  name: string;
  timeZone: string;
  /** Local opening and closing time, `HH:MM`, the same every day. */
  opensAt: string;
  closesAt: string;
}

export interface Resource {
  id: string;
  venueId: string;
  name: string;
  capacity: number;
}

interface VenueRow {
  id: string;
  name: string;
  time_zone: string;
  opens_at: string;
  closes_at: string;
}

interface ResourceRow {
  id: string;
  venue_id: string;
  name: string;
  capacity: number;
}

const venue = (r: VenueRow): Venue => ({ id: r.id, name: r.name, timeZone: r.time_zone, opensAt: formatTime(parseTime(r.opens_at)), closesAt: formatTime(parseTime(r.closes_at)) });
const resource = (r: ResourceRow): Resource => ({ id: r.id, venueId: r.venue_id, name: r.name, capacity: r.capacity });

const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const idParams = { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: UUID } } } as const;
const time = { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' } as const;

export async function getVenue(db: Db, id: string): Promise<Venue> {
  const { rows } = await db.query<VenueRow>('SELECT * FROM venues WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('venue');
  return venue(rows[0]);
}

/** A resource and its venue; `lock` holds the resource row until the transaction ends, so two bookings for it are made one at a time. */
export async function getResource(db: Db, id: string, options: { lock?: boolean } = {}): Promise<{ resource: Resource; venue: Venue }> {
  const { rows } = await db.query<ResourceRow>(`SELECT * FROM resources WHERE id = $1${options.lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!rows[0]) throw notFound('resource');
  return { resource: resource(rows[0]), venue: await getVenue(db, rows[0].venue_id) };
}

export function venueRoutes(app: FastifyInstance, db: Db): void {
  app.post<{ Body: { name: string; timeZone: string; opensAt: string; closesAt: string } }>(
    '/venues',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'timeZone', 'opensAt', 'closesAt'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, timeZone: { type: 'string', minLength: 1 }, opensAt: time, closesAt: time },
        },
      },
    },
    async (req, reply) => {
      const { name, timeZone, opensAt, closesAt } = req.body;
      if (!isTimeZone(timeZone)) throw ruleBroken('unknown_time_zone', `${timeZone} is not a time zone; use an IANA name such as Europe/London.`);
      if (opensAt === closesAt) throw ruleBroken('invalid_opening_hours', 'A venue must open and close at different times.');
      const { rows } = await db.query<VenueRow>('INSERT INTO venues (name, time_zone, opens_at, closes_at) VALUES ($1, $2, $3, $4) RETURNING *', [name.trim(), timeZone, opensAt, closesAt]);
      return reply.code(201).send(venue(rows[0]!));
    },
  );

  app.get<{ Params: { id: string } }>('/venues/:id', { schema: { params: idParams } }, async (req) => getVenue(db, req.params.id));

  app.post<{ Params: { id: string }; Body: { name: string; capacity: number } }>(
    '/venues/:id/resources',
    {
      schema: {
        params: idParams,
        body: { type: 'object', required: ['name', 'capacity'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, capacity: { type: 'integer', minimum: 1, maximum: 500 } } },
      },
    },
    async (req, reply) => {
      await getVenue(db, req.params.id);
      const existing = await db.query('SELECT 1 FROM resources WHERE venue_id = $1 AND lower(name) = lower($2)', [req.params.id, req.body.name.trim()]);
      if (existing.rows.length) throw ruleBroken('duplicate_resource', `This venue already has a resource called ${req.body.name.trim()}.`);
      const { rows } = await db.query<ResourceRow>('INSERT INTO resources (venue_id, name, capacity) VALUES ($1, $2, $3) RETURNING *', [req.params.id, req.body.name.trim(), req.body.capacity]);
      return reply.code(201).send(resource(rows[0]!));
    },
  );

  app.get<{ Params: { id: string } }>('/venues/:id/resources', { schema: { params: idParams } }, async (req) => {
    await getVenue(db, req.params.id);
    const { rows } = await db.query<ResourceRow>('SELECT * FROM resources WHERE venue_id = $1 ORDER BY name', [req.params.id]);
    return { resources: rows.map(resource) };
  });
}
