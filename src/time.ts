// Wall-clock times in a venue's time zone. Bookings are stored as instants (timestamptz); opening
// hours and "which day" are local to the venue. Times of day are minutes after midnight.

/** `18:30` → 1110. */
export function parseTime(text: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::00)?$/.exec(text);
  if (!m) throw new Error(`not a time of day: ${text}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 1110 → `18:30`. */
export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string): Intl.DateTimeFormat {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formats.set(tz, f);
  }
  return f;
}

/** The local date (`2026-11-26`) and time of day (minutes) of an instant in a time zone. */
export function localParts(at: Date, tz: string): { date: string; minutes: number } {
  const p = Object.fromEntries(format(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** How far the time zone is ahead of UTC at an instant, in minutes. */
function offsetMinutes(at: Date, tz: string): number {
  const p = Object.fromEntries(format(tz).formatToParts(at).map((x) => [x.type, Number(x.value)]));
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return Math.round((local - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant a local date and time of day are in a time zone. When clocks go back and the time
 * happens twice, the first; when they go forward and it never happens, moved forward by the gap
 * (01:30 on a night 01:00 jumps to 02:00 is 02:30), as most calendars do.
 */
export function zonedInstant(date: string, minutes: number, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`not a date: ${date}`);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, minutes);
  // Two offsets to try: the zone's offset a day either side of the wall time covers any change.
  const candidates = [...new Set([offsetMinutes(new Date(wall - 86_400_000), tz), offsetMinutes(new Date(wall + 86_400_000), tz)])]
    .map((off) => wall - off * 60_000)
    .filter((t) => offsetMinutes(new Date(t), tz) * 60_000 === wall - t)
    .sort((a, b) => a - b);
  if (candidates[0] !== undefined) return new Date(candidates[0]);
  // In a gap: read with the offset before the change, which moves it forward by the gap.
  return new Date(wall - offsetMinutes(new Date(wall - 86_400_000), tz) * 60_000);
}

/** Whether `text` is a real calendar date, `2026-02-29` being one only in a leap year. */
export function isDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === text;
}
