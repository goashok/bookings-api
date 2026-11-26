import { describe, expect, it } from 'vitest';
import { setup } from './support.ts';

const { call, venueWithTable } = setup();

describe('venues', () => {
  it('creates a venue and reads it back', async () => {
    const created = await call('POST', '/venues', { name: ' The Anchor ', timeZone: 'Europe/London', opensAt: '12:00', closesAt: '23:00' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'The Anchor', timeZone: 'Europe/London', opensAt: '12:00', closesAt: '23:00' });
    expect((await call('GET', `/venues/${created.body.id}`)).body).toEqual(created.body);
  });

  it('refuses an unknown time zone, equal opening and closing times, and a malformed request', async () => {
    expect((await call('POST', '/venues', { name: 'X', timeZone: 'Mars/Olympus', opensAt: '12:00', closesAt: '23:00' })).body).toMatchObject({ error: 'unknown_time_zone' });
    expect((await call('POST', '/venues', { name: 'X', timeZone: 'UTC', opensAt: '12:00', closesAt: '12:00' })).body).toMatchObject({ error: 'invalid_opening_hours' });
    const bad = await call('POST', '/venues', { name: 'X', timeZone: 'UTC', opensAt: '25:00', closesAt: '23:00' });
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('answers 404 for a venue that is not there, and for a malformed id', async () => {
    expect((await call('GET', '/venues/00000000-0000-0000-0000-000000000000')).body).toEqual({ error: 'not_found', message: 'No venue with that id.' });
    expect((await call('GET', '/venues/nope')).status).toBe(400);
    expect((await call('GET', '/nowhere')).body).toEqual({ error: 'not_found', message: 'No such endpoint.' });
  });
});

describe('resources', () => {
  it("adds tables to a venue and lists them by name; a name is used once per venue", async () => {
    const { venue } = await venueWithTable();
    expect((await call('POST', `/venues/${venue.id}/resources`, { name: 'Bar stool', capacity: 1 })).status).toBe(201);
    expect((await call('POST', `/venues/${venue.id}/resources`, { name: 'table 1', capacity: 2 })).body).toMatchObject({ error: 'duplicate_resource' });
    const list = await call('GET', `/venues/${venue.id}/resources`);
    expect(list.body.resources.map((r: { name: string; capacity: number }) => [r.name, r.capacity])).toEqual([['Bar stool', 1], ['Table 1', 4]]);
  });

  it('refuses a capacity under 1', async () => {
    const { venue } = await venueWithTable();
    expect((await call('POST', `/venues/${venue.id}/resources`, { name: 'Ghost table', capacity: 0 })).status).toBe(400);
  });
});
