import { resolveCompletionTimes } from '@/server/domain/completion-times';
import { describe, expect, it } from 'vitest';

describe('resolveCompletionTimes', () => {
  // Pickup 21:00 London (BST → 20:00 UTC) on 1 Jun 2026.
  const summerPickup = new Date('2026-06-01T20:00:00.000Z');

  it('derives waiting from passenger-on-board minus booked pickup (driver early)', () => {
    // Driver arrives 20:50, passenger on board 21:10 → 10 min waiting from the
    // 21:00 booked pickup; the early arrival is the driver's own margin.
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '20:50',
      passengerOnBoardTime: '21:10',
      completionTime: '22:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T19:50:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T20:10:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T21:00:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('measures waiting from the arrival when the driver is late (client not charged for it)', () => {
    // Driver arrives 21:15 (15 min late), passenger boards 21:20 → 5 min, not 20.
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '21:15',
      passengerOnBoardTime: '21:20',
      completionTime: '22:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.waitingTimeMinutes).toBe(5);
  });

  it('reports zero waiting when the passenger boards at or before the booked pickup', () => {
    const onTime = resolveCompletionTimes(summerPickup, {
      arrivalTime: '20:50',
      passengerOnBoardTime: '21:00',
      completionTime: '22:00',
    });
    expect(onTime.ok).toBe(true);
    if (onTime.ok) expect(onTime.waitingTimeMinutes).toBe(0);

    const early = resolveCompletionTimes(summerPickup, {
      arrivalTime: '20:45',
      passengerOnBoardTime: '20:55',
      completionTime: '22:00',
    });
    expect(early.ok).toBe(true);
    if (early.ok) {
      expect(early.waitingTimeMinutes).toBe(0);
      expect(early.passengerOnBoardAt.toISOString()).toBe('2026-06-01T19:55:00.000Z');
    }
  });

  it('rolls the drop-off past midnight while boarding stays on the pickup day', () => {
    // Pickup 23:00 London (BST → 22:00 UTC); arrive 22:50, board 23:10, complete 01:30.
    const latePickup = new Date('2026-06-01T22:00:00.000Z');
    const r = resolveCompletionTimes(latePickup, {
      arrivalTime: '22:50',
      passengerOnBoardTime: '23:10',
      completionTime: '01:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T22:10:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-02T00:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('rolls boarding past midnight when the passenger boards after 00:00', () => {
    // Pickup 23:50 London (BST → 22:50 UTC); arrive 23:45, board 00:05 next day.
    const nearMidnightPickup = new Date('2026-06-01T22:50:00.000Z');
    const r = resolveCompletionTimes(nearMidnightPickup, {
      arrivalTime: '23:45',
      passengerOnBoardTime: '00:05',
      completionTime: '01:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T23:05:00.000Z');
    expect(r.waitingTimeMinutes).toBe(15);
  });

  it('anchors an arrival before midnight for an after-midnight pickup to the previous day', () => {
    // Pickup 00:30 London on 2 Jun (BST → 23:30 UTC 1 Jun); driver arrives 23:50
    // the evening before, passenger boards 00:40.
    const smallHoursPickup = new Date('2026-06-01T23:30:00.000Z');
    const r = resolveCompletionTimes(smallHoursPickup, {
      arrivalTime: '23:50',
      passengerOnBoardTime: '00:40',
      completionTime: '01:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T22:50:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T23:40:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('applies the GMT (winter) offset correctly', () => {
    // Pickup 10:00 London on 15 Jan 2026 (GMT → 10:00 UTC).
    const winterPickup = new Date('2026-01-15T10:00:00.000Z');
    const r = resolveCompletionTimes(winterPickup, {
      arrivalTime: '09:55',
      passengerOnBoardTime: '10:07',
      completionTime: '10:45',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-01-15T09:55:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-01-15T10:45:00.000Z');
    expect(r.waitingTimeMinutes).toBe(7);
  });

  it('accepts a completion at exactly the on-board time (zero-length journey)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '21:00',
      passengerOnBoardTime: '21:05',
      completionTime: '21:05',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropoffAt.toISOString()).toBe(r.passengerOnBoardAt.toISOString());
  });

  it('rejects a malformed time in any field', () => {
    const base = {
      arrivalTime: '20:50',
      passengerOnBoardTime: '21:10',
      completionTime: '22:00',
    };
    for (const patch of [
      { arrivalTime: '9:5' },
      { passengerOnBoardTime: '25:00' },
      { completionTime: 'noon' },
    ]) {
      const r = resolveCompletionTimes(summerPickup, { ...base, ...patch });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('bad_format');
    }
  });

  it('rejects an implausibly long wait (> 12h)', () => {
    // Passenger "on board" 13.5h after a 09:00 pickup — almost certainly a typo.
    const morningPickup = new Date('2026-06-01T08:00:00.000Z'); // 09:00 London
    const r = resolveCompletionTimes(morningPickup, {
      arrivalTime: '08:55',
      passengerOnBoardTime: '22:30',
      completionTime: '23:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('waiting_too_long');
  });

  it('rejects an on-board time that lands a day after the arrival (order typo)', () => {
    // On-board a minute "before" arrival rolls to the next day → 24h wait → typo.
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '21:00',
      passengerOnBoardTime: '20:59',
      completionTime: '22:00',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('waiting_too_long');
  });
});

describe('resolveCompletionTimes — multi-stop journeys', () => {
  // Pickup 10:00 London (BST → 09:00 UTC) on 1 Jun 2026.
  const pickup = new Date('2026-06-01T09:00:00.000Z');
  const base = { arrivalTime: '09:55', passengerOnBoardTime: '10:12', completionTime: '13:30' };

  it('chains each stop between on-board and drop-off and sums the waiting', () => {
    const r = resolveCompletionTimes(pickup, {
      ...base,
      stops: [
        { arrivedTime: '10:40', leftTime: '11:25' }, // 45 min
        { arrivedTime: '12:00', leftTime: '12:10' }, // 10 min
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stopTimes.map((t) => [t.arrivedAt.toISOString(), t.departedAt.toISOString()])).toEqual(
      [
        ['2026-06-01T09:40:00.000Z', '2026-06-01T10:25:00.000Z'],
        ['2026-06-01T11:00:00.000Z', '2026-06-01T11:10:00.000Z'],
      ],
    );
    // 12 min at the pickup + 45 + 10 at the stops.
    expect(r.waitingTimeMinutes).toBe(67);
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T12:30:00.000Z');
  });

  it('is unchanged with no stops (empty list or omitted)', () => {
    const a = resolveCompletionTimes(pickup, base);
    const b = resolveCompletionTimes(pickup, { ...base, stops: [] });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.waitingTimeMinutes).toBe(12);
    expect(b.waitingTimeMinutes).toBe(12);
    expect(b.stopTimes).toEqual([]);
  });

  it('rolls a stop past midnight like the other times', () => {
    const latePickup = new Date('2026-06-01T22:00:00.000Z'); // 23:00 London
    const r = resolveCompletionTimes(latePickup, {
      arrivalTime: '22:50',
      passengerOnBoardTime: '23:05',
      stops: [{ arrivedTime: '23:50', leftTime: '00:20' }],
      completionTime: '01:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stopTimes[0]?.departedAt.toISOString()).toBe('2026-06-01T23:20:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(r.waitingTimeMinutes).toBe(5 + 30);
  });

  it('rejects a malformed stop time', () => {
    const r = resolveCompletionTimes(pickup, {
      ...base,
      stops: [{ arrivedTime: '10:40', leftTime: '25:00' }],
    });
    expect(r).toEqual({ ok: false, reason: 'bad_format' });
  });

  it('rejects a stop whose times put the total wait over 12 hours (order typo)', () => {
    const r = resolveCompletionTimes(pickup, {
      ...base,
      stops: [{ arrivedTime: '11:25', leftTime: '11:20' }],
    });
    expect(r).toEqual({ ok: false, reason: 'waiting_too_long' });
  });
});
