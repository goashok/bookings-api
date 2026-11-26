// Bookings: making one, looking one up, cancelling, a venue's bookings for a day, and the free
// times of a resource.
//
// The rules a new booking must keep:
// - it starts in the future, lasts 15 minutes to 4 hours, in steps of 15 minutes;
// - the party fits the resource;
// - it falls within the venue's opening hours, on one local day;
// - it does not overlap another confirmed booking of the same resource. The resource row is
//   locked while this is checked, so two requests for the same time can't both succeed.

import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { conflict, notFound, ruleBroken } from './errors.ts';
import { formatTime, isDate, localParts, parseTime, zonedInstant } from './time.ts';
import { getResource, getVenue, idParams, type Venue } from './venues.ts';

export interface Booking {
  id: string;
  resourceId: string;
  guestName: string;
  guestEmail: string;
  partySize: number;
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
  cancelledAt: string | null;
}

interface BookingRow {
  id: string;
  resource_id: string;
  guest_name: string;
  guest_email: string;
  party_size: number;
  starts_at: Date | string;
  ends_at: Date | string;
  status: 'confirmed' | 'cancelled';
  created_at: Date | string;
  cancelled_at: Date | string | null;
}

const iso = (v: Date | string) => new Date(v).toISOString();
const booking = (r: BookingRow): Booking => ({
  id: r.id,
  resourceId: r.resource_id,
  guestName: r.guest_name,
  guestEmail: r.guest_email,
  partySize: r.party_size,
  startsAt: iso(r.starts_at),
  endsAt: iso(r.ends_at),
  status: r.status,
  createdAt: iso(r.created_at),
  cancelledAt: r.cancelled_at === null ? null : iso(r.cancelled_at),
});

const MIN_MINUTES = 15;
const MAX_MINUTES = 240;
const STEP_MINUTES = 15;
/** An instant with its offset: `2026-11-26T19:00:00Z` or `2026-11-26T19:00:00+01:00`. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function instant(text: string, field: string): Date {
  const at = new Date(text);
  if (!INSTANT.test(text) || Number.isNaN(at.getTime())) throw ruleBroken('invalid_time', `${field} must be a date and time with its offset, such as 2026-11-26T19:00:00Z.`);
  return at;
}

/** Whether a booking from `start` to `end` falls within the venue's opening hours on one local day. */
export function withinOpeningHours(venue: Venue, start: Date, end: Date): boolean {
  const s = localParts(start, venue.timeZone);
  const e = localParts(end, venue.timeZone);
  return s.date === e.date && s.minutes >= parseTime(venue.opensAt) && e.minutes <= parseTime(venue.closesAt);
}

/** The instants a local day starts and ends at a venue. */
function dayBounds(date: string, tz: string): [Date, Date] {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return [zonedInstant(date, 0, tz), zonedInstant(next, 0, tz)];
}

export interface BookingOptions {
  now: () => Date;
}

export function bookingRoutes(app: FastifyInstance, db: Db, options: BookingOptions): void {
  app.post<{ Body: { resourceId: string; guestName: string; guestEmail: string; partySize: number; startsAt: string; endsAt: string } }>(
    '/bookings',
    {
      schema: {
        body: {
          type: 'object',
          required: ['resourceId', 'guestName', 'guestEmail', 'partySize', 'startsAt', 'endsAt'],
          additionalProperties: false,
          properties: {
            resourceId: idParams.properties.id,
            guestName: { type: 'string', minLength: 1, maxLength: 200 },
            guestEmail: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', maxLength: 320 },
            partySize: { type: 'integer', minimum: 1 },
            startsAt: { type: 'string' },
            endsAt: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const start = instant(body.startsAt, 'startsAt');
      const end = instant(body.endsAt, 'endsAt');
      const minutes = (end.getTime() - start.getTime()) / 60_000;
      if (minutes < MIN_MINUTES || minutes > MAX_MINUTES || minutes % STEP_MINUTES !== 0) {
        throw ruleBroken('invalid_duration', `A booking lasts ${MIN_MINUTES} minutes to ${MAX_MINUTES / 60} hours, in steps of ${STEP_MINUTES} minutes.`);
      }
      if (start.getTime() <= options.now().getTime()) throw ruleBroken('in_the_past', 'A booking must start in the future.');

      const created = await db.transaction(async (tx) => {
        const { resource, venue } = await getResource(tx, body.resourceId, { lock: true });
        if (body.partySize > resource.capacity) throw ruleBroken('party_too_large', `${resource.name} seats up to ${resource.capacity}; this party is ${body.partySize}.`);
        if (!withinOpeningHours(venue, start, end)) {
          throw ruleBroken('outside_opening_hours', `${venue.name} is open ${venue.opensAt} to ${venue.closesAt} (${venue.timeZone}); the booking must fall within that.`);
        }
        const clash = await tx.query<BookingRow>(
          `SELECT * FROM bookings WHERE resource_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2 ORDER BY starts_at LIMIT 1`,
          [resource.id, start, end],
        );
        if (clash.rows[0]) {
          const other = booking(clash.rows[0]);
          const local = (at: string) => formatTime(localParts(new Date(at), venue.timeZone).minutes);
          throw conflict('already_booked', `${resource.name} is booked from ${local(other.startsAt)} to ${local(other.endsAt)} that day.`);
        }
        const { rows } = await tx.query<BookingRow>(
          `INSERT INTO bookings (resource_id, guest_name, guest_email, party_size, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [resource.id, body.guestName.trim(), body.guestEmail.trim(), body.partySize, start, end],
        );
        return booking(rows[0]!);
      });
      return reply.code(201).send(created);
    },
  );

  app.get<{ Params: { id: string } }>('/bookings/:id', { schema: { params: idParams } }, async (req) => {
    const { rows } = await db.query<BookingRow>('SELECT * FROM bookings WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('booking');
    return booking(rows[0]);
  });

  app.post<{ Params: { id: string } }>('/bookings/:id/cancel', { schema: { params: idParams } }, async (req) => {
    const { rows } = await db.query<BookingRow>(
      `UPDATE bookings SET status = 'cancelled', cancelled_at = $2 WHERE id = $1 AND status = 'confirmed' RETURNING *`,
      [req.params.id, options.now()],
    );
    if (rows[0]) return booking(rows[0]);
    const exists = await db.query('SELECT 1 FROM bookings WHERE id = $1', [req.params.id]);
    if (!exists.rows.length) throw notFound('booking');
    throw conflict('already_cancelled', 'This booking is already cancelled.');
  });

  app.get<{ Params: { id: string }; Querystring: { date: string } }>(
    '/venues/:id/bookings',
    { schema: { params: idParams, querystring: { type: 'object', required: ['date'], properties: { date: { type: 'string' } } } } },
    async (req) => {
      if (!isDate(req.query.date)) throw ruleBroken('invalid_date', 'date must be a calendar date, such as 2026-11-26.');
      const venue = await getVenue(db, req.params.id);
      const [from, to] = dayBounds(req.query.date, venue.timeZone);
      const { rows } = await db.query<BookingRow>(
        `SELECT b.* FROM bookings b JOIN resources r ON r.id = b.resource_id
         WHERE r.venue_id = $1 AND b.status = 'confirmed' AND b.starts_at >= $2 AND b.starts_at < $3 ORDER BY b.starts_at, r.name`,
        [venue.id, from, to],
      );
      return { date: req.query.date, timeZone: venue.timeZone, bookings: rows.map(booking) };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { date: string; minutes?: number } }>(
    '/resources/:id/availability',
    {
      schema: {
        params: idParams,
        querystring: { type: 'object', required: ['date'], properties: { date: { type: 'string' }, minutes: { type: 'integer', minimum: MIN_MINUTES, maximum: MAX_MINUTES, multipleOf: STEP_MINUTES, default: 60 } } },
      },
    },
    async (req) => {
      if (!isDate(req.query.date)) throw ruleBroken('invalid_date', 'date must be a calendar date, such as 2026-11-26.');
      const length = req.query.minutes ?? 60;
      const { resource, venue } = await getResource(db, req.params.id);
      const [from, to] = dayBounds(req.query.date, venue.timeZone);
      const taken = (
        await db.query<BookingRow>(`SELECT * FROM bookings WHERE resource_id = $1 AND status = 'confirmed' AND starts_at < $3 AND ends_at > $2`, [resource.id, from, to])
      ).rows.map((r) => [new Date(r.starts_at).getTime(), new Date(r.ends_at).getTime()] as const);
      const now = options.now().getTime();
      const slots: Array<{ startsAt: string; endsAt: string }> = [];
      // Every 15 minutes from opening, each slot `length` long, that is free, in the future, and within opening hours.
      for (let m = parseTime(venue.opensAt); m + length <= 24 * 60; m += STEP_MINUTES) {
        const start = zonedInstant(req.query.date, m, venue.timeZone);
        const end = new Date(start.getTime() + length * 60_000);
        if (start.getTime() <= now || !withinOpeningHours(venue, start, end)) continue;
        if (taken.some(([s, e]) => s < end.getTime() && e > start.getTime())) continue;
        slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
      }
      return { resourceId: resource.id, date: req.query.date, timeZone: venue.timeZone, minutes: length, slots };
    },
  );
}
