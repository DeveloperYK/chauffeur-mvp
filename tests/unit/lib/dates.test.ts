import {
  calendarGrid,
  formatLondonDateTime,
  formatLondonDay,
  formatLondonDayLong,
  formatLondonMonth,
  formatLondonMonthLong,
  formatLondonMonthShort,
  formatLondonTimeOfDay,
  londonDayRangeUtc,
  londonDayStartUtc,
  londonMonthRangeUtc,
  londonOffsetMs,
  londonTodayString,
  offsetMonth,
  parseDayString,
  parseMonthString,
} from '@/lib/dates';
import { describe, expect, it } from 'vitest';

const HOUR = 60 * 60 * 1000;

describe('formatLondonTimeOfDay', () => {
  it('renders winter (GMT) time unchanged', () => {
    expect(formatLondonTimeOfDay(new Date('2026-01-15T08:30:00Z'))).toBe('08:30');
  });
  it('renders summer (BST) time +1h', () => {
    expect(formatLondonTimeOfDay(new Date('2026-06-01T08:30:00Z'))).toBe('09:30');
  });
});

describe('formatLondonDateTime', () => {
  it('includes the BST-adjusted time and the date', () => {
    const s = formatLondonDateTime(new Date('2026-06-01T08:30:00Z'));
    expect(s).toContain('09:30');
    expect(s).toContain('Jun');
    expect(s).toContain('2026');
    expect(s).not.toContain('UTC');
  });
  it('is unchanged in winter (GMT)', () => {
    expect(formatLondonDateTime(new Date('2026-01-15T08:30:00Z'))).toContain('08:30');
  });
});

describe('londonOffsetMs', () => {
  it('returns 0 during GMT (winter)', () => {
    // 15 January is firmly in GMT
    expect(londonOffsetMs(new Date('2026-01-15T12:00:00Z'))).toBe(0);
  });

  it('returns +1h during BST (summer)', () => {
    expect(londonOffsetMs(new Date('2026-07-15T12:00:00Z'))).toBe(HOUR);
  });
});

describe('parseDayString', () => {
  it('parses a valid date', () => {
    expect(parseDayString('2026-05-19')).toEqual({ y: 2026, m: 5, d: 19 });
  });

  it('rejects malformed input', () => {
    expect(parseDayString('not-a-date')).toBeNull();
    expect(parseDayString('2026-13-01')).toBeNull();
    expect(parseDayString('2026-02-30')).toBeNull(); // Feb 30 doesn't exist
    expect(parseDayString('')).toBeNull();
  });
});

describe('londonDayStartUtc', () => {
  it('GMT day starts at YYYY-MM-DDT00:00:00Z', () => {
    expect(londonDayStartUtc('2026-01-15')?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('BST day starts at previous-day-23:00:00Z', () => {
    expect(londonDayStartUtc('2026-07-15')?.toISOString()).toBe('2026-07-14T23:00:00.000Z');
  });

  it('returns null for bad input', () => {
    expect(londonDayStartUtc('bogus')).toBeNull();
  });
});

describe('londonDayRangeUtc', () => {
  it('GMT day is exactly 24h', () => {
    const r = londonDayRangeUtc('2026-01-15');
    expect(r?.startUtc.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(r?.endUtc.toISOString()).toBe('2026-01-16T00:00:00.000Z');
  });

  it('BST day is exactly 24h, shifted by -1h', () => {
    const r = londonDayRangeUtc('2026-07-15');
    expect(r?.startUtc.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    expect(r?.endUtc.toISOString()).toBe('2026-07-15T23:00:00.000Z');
  });

  it('spring-forward day is 23h (no London 01:00–02:00)', () => {
    // 2026 BST starts 2026-03-29
    const r = londonDayRangeUtc('2026-03-29');
    expect(r?.startUtc.toISOString()).toBe('2026-03-29T00:00:00.000Z');
    expect(r?.endUtc.toISOString()).toBe('2026-03-29T23:00:00.000Z');
    const hours = ((r?.endUtc.getTime() ?? 0) - (r?.startUtc.getTime() ?? 0)) / HOUR;
    expect(hours).toBe(23);
  });

  it('autumn-back day is 25h', () => {
    // 2026 BST ends 2026-10-25
    const r = londonDayRangeUtc('2026-10-25');
    expect(r?.startUtc.toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(r?.endUtc.toISOString()).toBe('2026-10-26T00:00:00.000Z');
    const hours = ((r?.endUtc.getTime() ?? 0) - (r?.startUtc.getTime() ?? 0)) / HOUR;
    expect(hours).toBe(25);
  });
});

describe('formatLondonDay / londonTodayString', () => {
  it('formats a UTC instant to its London day', () => {
    // 2026-05-19T23:30:00Z is already 2026-05-20 in London BST
    expect(formatLondonDay(new Date('2026-05-19T23:30:00Z'))).toBe('2026-05-20');
  });

  it('GMT pre-midnight stays on the same day', () => {
    // 2026-01-15T23:30:00Z is 2026-01-15 23:30 in London (GMT)
    expect(formatLondonDay(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
  });

  it('londonTodayString matches formatLondonDay(now)', () => {
    const now = new Date('2026-05-19T22:00:00Z'); // 23:00 BST → still 19th
    expect(londonTodayString(now)).toBe('2026-05-19');
    expect(londonTodayString(new Date('2026-05-19T23:30:00Z'))).toBe('2026-05-20');
  });
});

describe('parseMonthString / formatLondonMonth', () => {
  it('parses YYYY-MM', () => {
    expect(parseMonthString('2026-05')).toBe('2026-05-01');
    expect(parseMonthString('2026-13')).toBeNull();
    expect(parseMonthString('bad')).toBeNull();
  });

  it('formatLondonMonth returns YYYY-MM', () => {
    expect(formatLondonMonth(new Date('2026-05-19T12:00:00Z'))).toBe('2026-05');
  });
});

describe('londonMonthRangeUtc', () => {
  it('covers May 2026', () => {
    const r = londonMonthRangeUtc('2026-05');
    // 1 May 2026 BST → start is 30 Apr 23:00 UTC
    expect(r?.startUtc.toISOString()).toBe('2026-04-30T23:00:00.000Z');
    // End is 1 June 2026 00:00 BST → 31 May 23:00 UTC
    expect(r?.endUtc.toISOString()).toBe('2026-05-31T23:00:00.000Z');
  });

  it('covers Jan 2026 in GMT', () => {
    const r = londonMonthRangeUtc('2026-01');
    expect(r?.startUtc.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r?.endUtc.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('offsetMonth', () => {
  it('handles same year', () => {
    expect(offsetMonth('2026-05', 1)).toBe('2026-06');
    expect(offsetMonth('2026-05', -1)).toBe('2026-04');
  });

  it('handles year boundary', () => {
    expect(offsetMonth('2026-01', -1)).toBe('2025-12');
    expect(offsetMonth('2026-12', 1)).toBe('2027-01');
    expect(offsetMonth('2026-06', -18)).toBe('2024-12');
  });
});

describe('formatLondonDayLong', () => {
  it('renders a friendly string', () => {
    expect(formatLondonDayLong('2026-05-19')).toBe('Tue, 19 May 2026');
  });
});

describe('formatLondonMonthLong', () => {
  it('renders a friendly month string', () => {
    expect(formatLondonMonthLong('2026-05')).toBe('May 2026');
  });
});

describe('formatLondonMonthShort', () => {
  it('renders the short London month for an instant', () => {
    expect(formatLondonMonthShort(new Date('2026-06-10T09:00:00.000Z'))).toBe('Jun');
    expect(formatLondonMonthShort(new Date('2026-04-15T09:00:00.000Z'))).toBe('Apr');
  });

  it('honours the London timezone at a UTC day boundary', () => {
    // 23:30 UTC on 30 Jun is 00:30 BST on 1 Jul in London.
    expect(formatLondonMonthShort(new Date('2026-06-30T23:30:00.000Z'))).toBe('Jul');
  });
});

describe('calendarGrid', () => {
  it('returns 42 day strings', () => {
    const days = calendarGrid('2026-05');
    expect(days.length).toBe(42);
  });

  it('starts on the Monday of the week containing the 1st', () => {
    // 1 May 2026 is a Friday. Calendar starts on the prior Monday (27 Apr).
    const days = calendarGrid('2026-05');
    expect(days[0]).toBe('2026-04-27');
    expect(days[4]).toBe('2026-05-01');
  });

  it('grid for January 2026 (1 Jan is a Thursday)', () => {
    const days = calendarGrid('2026-01');
    expect(days[0]).toBe('2025-12-29');
    expect(days[3]).toBe('2026-01-01');
  });
});
