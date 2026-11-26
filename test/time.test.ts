import { describe, expect, it } from 'vitest';
import { formatTime, isDate, isTimeZone, localParts, parseTime, zonedInstant } from '../src/time.ts';

describe('times of day', () => {
  it('reads and writes HH:MM', () => {
    expect(parseTime('18:30')).toBe(1110);
    expect(parseTime('09:05:00')).toBe(545);
    expect(formatTime(1110)).toBe('18:30');
    expect(() => parseTime('24:00')).toThrow('not a time of day');
    expect(() => parseTime('9:30')).toThrow('not a time of day');
  });

  it('knows real dates and time zones', () => {
    expect(isDate('2028-02-29')).toBe(true);
    expect(isDate('2027-02-29')).toBe(false);
    expect(isDate('2027-13-01')).toBe(false);
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('local time in a venue', () => {
  it('turns a local date and time into an instant and back', () => {
    const at = zonedInstant('2026-11-26', parseTime('19:00'), 'America/New_York');
    expect(at.toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(localParts(at, 'America/New_York')).toEqual({ date: '2026-11-26', minutes: 1140 });
    expect(zonedInstant('2026-07-01', parseTime('19:00'), 'Europe/London').toISOString()).toBe('2026-07-01T18:00:00.000Z');
    expect(zonedInstant('2026-07-01', parseTime('09:30'), 'Asia/Kolkata').toISOString()).toBe('2026-07-01T04:00:00.000Z');
  });

  it('handles the days the clocks change', () => {
    // London, 29 March 2026: 01:00 jumps to 02:00, so 01:30 never happens.
    expect(zonedInstant('2026-03-29', parseTime('01:30'), 'Europe/London').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(zonedInstant('2026-03-29', parseTime('03:00'), 'Europe/London').toISOString()).toBe('2026-03-29T02:00:00.000Z');
    // 25 October 2026: 01:30 happens twice; the first one is meant.
    expect(zonedInstant('2026-10-25', parseTime('01:30'), 'Europe/London').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedInstant('2026-10-25', parseTime('12:00'), 'Europe/London').toISOString()).toBe('2026-10-25T12:00:00.000Z');
  });
});
