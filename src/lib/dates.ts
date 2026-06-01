/**
 * Europe/London ⇄ UTC date helpers.
 *
 * All `pickup_at` timestamps in the database are stored as UTC. Operators
 * think in Europe/London (UK time, including BST). These helpers convert
 * between a Y-M-D "day" string (London) and the UTC instants that bound it.
 *
 * DST-correct: on the spring-forward day (March) the day is 23 hours;
 * on autumn-back (October) it's 25 hours. We compute `endUtc` from the
 * next day's start, not by adding a fixed 24h.
 */

const LONDON_TZ = 'Europe/London';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Offset from UTC at the given instant, expressed in milliseconds.
 *  London winter (GMT): 0. London summer (BST): +3 600 000. */
export function londonOffsetMs(at: Date): number {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    timeZoneName: 'longOffset',
    year: 'numeric',
  });
  const parts = fmt.formatToParts(at);
  const tz = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  if (tz === 'GMT' || tz === 'UTC') return 0;
  const m = tz.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m || m[1] === undefined || m[2] === undefined) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]);
  const minutes = m[3] !== undefined && m[3] !== '' ? Number(m[3]) : 0;
  return sign * (hours * 60 + minutes) * 60_000;
}

/** Parse "YYYY-MM-DD". Returns null for invalid input. */
export function parseDayString(s: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** UTC instant of the start of the given London day. */
export function londonDayStartUtc(dayStr: string): Date | null {
  const parsed = parseDayString(dayStr);
  if (!parsed) return null;
  const { y, m, d } = parsed;
  // Reference: midnight UTC on the target Y-M-D. London offset at that
  // instant tells us how to shift to get London midnight.
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return new Date(guess.getTime() - londonOffsetMs(guess));
}

/** UTC instants bounding the given London day. End is exclusive. */
export function londonDayRangeUtc(dayStr: string): { startUtc: Date; endUtc: Date } | null {
  const parsed = parseDayString(dayStr);
  if (!parsed) return null;
  const { y, m, d } = parsed;
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const startUtc = new Date(guess.getTime() - londonOffsetMs(guess));
  const nextGuess = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0));
  const endUtc = new Date(nextGuess.getTime() - londonOffsetMs(nextGuess));
  return { startUtc, endUtc };
}

/** Format a Date as "YYYY-MM-DD" in Europe/London. */
export function formatLondonDay(at: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    // en-CA gives YYYY-MM-DD
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(at);
}

/** Today as "YYYY-MM-DD" in Europe/London. */
export function londonTodayString(now: Date = new Date()): string {
  return formatLondonDay(now);
}

/** Format a Date as "HH:mm" (24h) in Europe/London — BST-aware. */
export function formatLondonTimeOfDay(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/**
 * Compact 24h date+time for customer/driver messages, e.g. "Sat 23 May, 14:00"
 * (Europe/London, BST-aware, no year for brevity).
 */
export function formatLondonDateTimeShort(at: Date): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
    .format(at)
    .replace(/,/g, '');
  return `${date}, ${formatLondonTimeOfDay(at)}`;
}

/**
 * Readable UK date+time for messages/links, e.g. "Mon 1 Jun 2026, 09:30".
 * Always Europe/London (BST-aware) — never UTC.
 */
export function formatLondonDateTime(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** Format a Date as "YYYY-MM" in Europe/London. */
export function formatLondonMonth(at: Date): string {
  return formatLondonDay(at).slice(0, 7);
}

/** Short London month name for an instant, e.g. "Jun". */
export function formatLondonMonthShort(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'short' }).format(at);
}

/** Validate a "YYYY-MM" month string and return its first day as a YYYY-MM-DD string. */
export function parseMonthString(s: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** UTC instants bounding the given London calendar month. End is exclusive. */
export function londonMonthRangeUtc(monthStr: string): { startUtc: Date; endUtc: Date } | null {
  const first = parseMonthString(monthStr);
  if (!first) return null;
  const startRange = londonDayRangeUtc(first);
  if (!startRange) return null;
  // Last day of month
  const [yStr, mStr] = monthStr.split('-');
  if (!yStr || !mStr) return null;
  const y = Number(yStr);
  const m = Number(mStr);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this
  const last = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
  const lastRange = londonDayRangeUtc(last);
  if (!lastRange) return null;
  return { startUtc: startRange.startUtc, endUtc: lastRange.endUtc };
}

/** Offset a "YYYY-MM" string by ±n months. */
export function offsetMonth(monthStr: string, deltaMonths: number): string {
  const [yStr, mStr] = monthStr.split('-');
  if (!yStr || !mStr) return monthStr;
  let y = Number(yStr);
  let m = Number(mStr) - 1 + deltaMonths;
  while (m < 0) {
    m += 12;
    y -= 1;
  }
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Pretty-format a YYYY-MM-DD string as "Mon 19 May 2026" in London. */
export function formatLondonDayLong(dayStr: string): string {
  const range = londonDayRangeUtc(dayStr);
  if (!range) return dayStr;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return fmt.format(range.startUtc);
}

/** Pretty-format a YYYY-MM string as "May 2026" in London. */
export function formatLondonMonthLong(monthStr: string): string {
  const first = parseMonthString(monthStr);
  if (!first) return monthStr;
  const range = londonDayRangeUtc(first);
  if (!range) return monthStr;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    month: 'long',
    year: 'numeric',
  });
  return fmt.format(range.startUtc);
}

/** All Y-M-D day strings in the calendar grid for a given month: 6 rows × 7 cols,
 *  Monday-first. Includes trailing days of previous month and leading days of next. */
export function calendarGrid(monthStr: string): string[] {
  const first = parseMonthString(monthStr);
  if (!first) return [];
  const range = londonDayRangeUtc(first);
  if (!range) return [];
  // Weekday of the first of the month in London (1 = Mon, 7 = Sun)
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    weekday: 'short',
  });
  const weekdayLabel = fmt.format(range.startUtc);
  const weekdayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekdayLabel);
  const leading = weekdayIdx; // number of days from previous month to fill the first row

  // Build 42 day strings starting from (first - leading) days.
  const days: string[] = [];
  for (let i = 0; i < 42; i++) {
    const offset = i - leading;
    const instant = new Date(range.startUtc.getTime() + offset * DAY_MS + 12 * 60 * 60 * 1000);
    // +12h to dodge any DST edge near midnight
    days.push(formatLondonDay(instant));
  }
  return days;
}
