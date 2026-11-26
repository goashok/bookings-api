import { describe, expect, it } from 'vitest';
import { setup } from './support.ts';

const { call, clock, latency, venueWithTable, book } = setup();

// 23 November 2026 is a Monday; London is on UTC (GMT) then.
describe('making a booking', () => {
  it('books a free table and reads the booking back', async () => {
    const { table } = await venueWithTable();
    const made = await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T21:00:00Z');
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ resourceId: table.id, guestName: 'Ada Lovelace', partySize: 2, startsAt: '2026-11-24T19:00:00.000Z', endsAt: '2026-11-24T21:00:00.000Z', status: 'confirmed', cancelledAt: null });
    expect((await call('GET', `/bookings/${made.body.id}`)).body).toEqual(made.body);
  });

  it('accepts times with an offset', async () => {
    const { table } = await venueWithTable();
    const made = await book(table.id, '2026-11-24T20:00:00+01:00', '2026-11-24T21:00:00+01:00');
    expect(made.body.startsAt).toBe('2026-11-24T19:00:00.000Z');
  });

  it('refuses a booking that overlaps another, and says when the table is taken', async () => {
    const { table } = await venueWithTable();
    await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T21:00:00Z');
    const clash = await book(table.id, '2026-11-24T20:30:00Z', '2026-11-24T22:00:00Z');
    expect(clash).toEqual({ status: 409, body: { error: 'already_booked', message: 'Table 1 is booked from 19:00 to 21:00 that day.' } });
    // Back to back is fine.
    expect((await book(table.id, '2026-11-24T21:00:00Z', '2026-11-24T22:00:00Z')).status).toBe(201);
  });

  // A real race needs real PostgreSQL (TEST_DATABASE_URL, as CI runs it): PGlite runs one transaction at a time.
  it('lets overlapping bookings race, and keeps only one', async () => {
    const { table } = await venueWithTable();
    latency.ms = 20;
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => book(table.id, `2026-11-24T19:${String(i * 5).padStart(2, '0')}:00Z`, `2026-11-24T20:${String(i * 5).padStart(2, '0')}:00Z`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
  });

  it('keeps the booking rules', async () => {
    const { table } = await venueWithTable();
    const error = async (start: string, end: string, extra = {}) => (await book(table.id, start, end, extra)).body.error;
    expect(await error('2026-11-24T19:00:00Z', '2026-11-24T19:10:00Z')).toBe('invalid_duration');
    expect(await error('2026-11-24T12:00:00Z', '2026-11-24T16:15:00Z')).toBe('invalid_duration');
    expect(await error('2026-11-24T19:00:00Z', '2026-11-24T20:20:00Z')).toBe('invalid_duration');
    expect(await error('2026-11-22T19:00:00Z', '2026-11-22T20:00:00Z')).toBe('in_the_past');
    expect(await error('2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z', { partySize: 5 })).toBe('party_too_large');
    expect(await error('2026-11-24T11:00:00Z', '2026-11-24T12:00:00Z')).toBe('outside_opening_hours');
    expect(await error('2026-11-24T22:30:00Z', '2026-11-24T23:30:00Z')).toBe('outside_opening_hours');
    expect(await error('2026-11-24 19:00', '2026-11-24T20:00:00Z')).toBe('invalid_time');
    expect((await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z', { guestEmail: 'not an email' })).status).toBe(400);
    expect((await book('00000000-0000-0000-0000-000000000000', '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z')).body.error).toBe('not_found');
  });

  it('says why a party is too large, and what the opening hours are, in words', async () => {
    const { table } = await venueWithTable();
    expect((await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z', { partySize: 6 })).body.message).toBe('Table 1 seats up to 4; this party is 6.');
    expect((await book(table.id, '2026-11-24T10:00:00Z', '2026-11-24T11:00:00Z')).body.message).toBe('The Anchor is open 12:00 to 23:00 (Europe/London); the booking must fall within that.');
  });

  it("reads opening hours in the venue's own time zone", async () => {
    // New York is 5 hours behind UTC in November: 19:00 there is 00:00 UTC the next day.
    const { table } = await venueWithTable({ timeZone: 'America/New_York' });
    expect((await book(table.id, '2026-11-25T00:00:00Z', '2026-11-25T01:00:00Z')).status).toBe(201);
    expect((await book(table.id, '2026-11-24T16:00:00Z', '2026-11-24T17:00:00Z')).body.error).toBe('outside_opening_hours');
  });
});

describe('cancelling', () => {
  it('cancels a booking once, and frees its time', async () => {
    const { table } = await venueWithTable();
    const made = await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T21:00:00Z');
    clock.now = new Date('2026-11-23T10:15:00Z');
    const cancelled = await call('POST', `/bookings/${made.body.id}/cancel`);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledAt: '2026-11-23T10:15:00.000Z' });
    expect((await call('POST', `/bookings/${made.body.id}/cancel`)).body).toMatchObject({ error: 'already_cancelled' });
    expect((await call('POST', '/bookings/00000000-0000-0000-0000-000000000000/cancel')).status).toBe(404);
    expect((await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T21:00:00Z')).status).toBe(201);
  });
});

describe("a venue's day", () => {
  it("lists the day's confirmed bookings, by the venue's local date", async () => {
    const { venue, table } = await venueWithTable({ timeZone: 'America/New_York' });
    const late = await book(table.id, '2026-11-25T03:00:00Z', '2026-11-25T04:00:00Z'); // 22:00 on the 24th in New York
    const next = await book(table.id, '2026-11-25T17:00:00Z', '2026-11-25T18:00:00Z'); // 12:00 on the 25th
    const gone = await book(table.id, '2026-11-24T18:00:00Z', '2026-11-24T19:00:00Z');
    await call('POST', `/bookings/${gone.body.id}/cancel`);
    const day = await call('GET', `/venues/${venue.id}/bookings?date=2026-11-24`);
    expect(day.body.bookings.map((b: { id: string }) => b.id)).toEqual([late.body.id]);
    expect((await call('GET', `/venues/${venue.id}/bookings?date=2026-11-25`)).body.bookings.map((b: { id: string }) => b.id)).toEqual([next.body.id]);
    expect((await call('GET', `/venues/${venue.id}/bookings?date=2026-11-31`)).body.error).toBe('invalid_date');
  });
});

describe('availability', () => {
  it('lists free times within opening hours, every 15 minutes, around existing bookings', async () => {
    const { table } = await venueWithTable({ opensAt: '18:00', closesAt: '21:00' });
    await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z');
    const free = await call('GET', `/resources/${table.id}/availability?date=2026-11-24&minutes=60`);
    expect(free.body.slots.map((s: { startsAt: string }) => s.startsAt.slice(11, 16))).toEqual(['18:00', '20:00']);
    const short = await call('GET', `/resources/${table.id}/availability?date=2026-11-24&minutes=30`);
    expect(short.body.slots.map((s: { startsAt: string }) => s.startsAt.slice(11, 16))).toEqual(['18:00', '18:15', '18:30', '20:00', '20:15', '20:30']);
  });

  it('leaves out times already past, and refuses lengths it cannot book', async () => {
    const { table } = await venueWithTable({ opensAt: '08:00', closesAt: '11:00' });
    const today = await call('GET', `/resources/${table.id}/availability?date=2026-11-23&minutes=60`);
    expect(today.body.slots.map((s: { startsAt: string }) => s.startsAt.slice(11, 16))).toEqual(['09:15', '09:30', '09:45', '10:00']);
    expect((await call('GET', `/resources/${table.id}/availability?date=2026-11-24&minutes=20`)).status).toBe(400);
  });
});

describe('looking up a guest’s upcoming bookings', () => {
  const lookup = (email: string) => call('GET', `/bookings?guestEmail=${encodeURIComponent(email)}`);

  it('matches the email ignoring case, in both directions', async () => {
    const { table } = await venueWithTable();
    await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z');
    await book(table.id, '2026-11-25T19:00:00Z', '2026-11-25T20:00:00Z', { guestEmail: 'Grace@Example.com' });
    const a = await lookup('  Ada@Example.COM ');
    expect(a.status).toBe(200);
    expect(a.body.guestEmail).toBe('Ada@Example.COM');
    expect(a.body.bookings).toHaveLength(1);
    expect((await lookup('grace@example.com')).body.bookings).toHaveLength(1);
  });

  it('excludes cancelled, past and other guests’ bookings; includes one in progress', async () => {
    const { table } = await venueWithTable();
    const cancelled = await book(table.id, '2026-11-24T12:00:00Z', '2026-11-24T13:00:00Z');
    await call('POST', `/bookings/${cancelled.body.id}/cancel`);
    await book(table.id, '2026-11-24T14:00:00Z', '2026-11-24T15:00:00Z', { guestEmail: 'other@example.com' });
    const kept = await book(table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z');
    expect((await lookup('ada@example.com')).body.bookings.map((b: any) => b.id)).toEqual([kept.body.id]);
    clock.now = new Date('2026-11-24T19:30:00Z');
    expect((await lookup('ada@example.com')).body.bookings).toHaveLength(1);
    clock.now = new Date('2026-11-24T20:00:00Z');
    expect((await lookup('ada@example.com')).body.bookings).toEqual([]);
    clock.now = new Date('2026-11-24T20:00:01Z');
    expect((await lookup('ada@example.com')).body.bookings).toEqual([]);
  });

  it('orders across venues, ties by resource name, and names venue, resource and time zone', async () => {
    const a = await venueWithTable({ name: 'Zed', timeZone: 'Europe/Paris' });
    const b = await venueWithTable({ name: 'Alpha' });
    const late = await book(a.table.id, '2026-11-25T19:00:00Z', '2026-11-25T20:00:00Z');
    const tieZ = await book(a.table.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z');
    const other = await call('POST', `/venues/${b.venue.id}/resources`, { name: 'Booth', capacity: 4 });
    const tieB = await book(other.body.id, '2026-11-24T19:00:00Z', '2026-11-24T20:00:00Z');
    const res = await lookup('ada@example.com');
    expect(res.body.bookings.map((x: any) => x.id)).toEqual([tieB.body.id, tieZ.body.id, late.body.id]);
    expect(res.body.bookings[0]).toMatchObject({ ...tieB.body, venueId: b.venue.id, venueName: 'Alpha', resourceName: 'Booth', timeZone: 'Europe/London' });
    expect(res.body.bookings[1]).toMatchObject({ venueId: a.venue.id, venueName: 'Zed', resourceName: 'Table 1', timeZone: 'Europe/Paris' });
  });

  it('gives an empty list for an unknown address', async () => {
    expect(await lookup('nobody@example.com')).toEqual({ status: 200, body: { guestEmail: 'nobody@example.com', bookings: [] } });
  });

  it('refuses a missing or empty guestEmail', async () => {
    expect((await call('GET', '/bookings')).body.error).toBe('invalid_request');
    expect((await call('GET', '/bookings?guestEmail=')).status).toBe(400);
    expect((await call('GET', '/bookings?guestEmail=%20%20')).body.error).toBe('invalid_request');
  });
});
