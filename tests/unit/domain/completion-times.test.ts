import { resolveCompletionTimes } from '@/server/domain/completion-times';
import { describe, expect, it } from 'vitest';

describe('resolveCompletionTimes', () => {
  // Pickup 10:00 London (BST → 09:00 UTC) on 1 Jun 2026.
  const summerPickup = new Date('2026-06-01T09:00:00.000Z');

  it('resolves a normal same-day trip and derives on-board from arrival + waiting', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '09:55',
      waitingMinutes: 10,
      completionTime: '11:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T08:55:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T09:05:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T10:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('treats 0 waiting minutes as on-board === arrival (arrived on time)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '09:55',
      waitingMinutes: 0,
      completionTime: '11:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T08:55:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T08:55:00.000Z');
    expect(r.waitingTimeMinutes).toBe(0);
  });

  it('rolls past midnight: an 11pm pickup completing at 1:30am is next-day', () => {
    // Pickup 23:00 London (BST → 22:00 UTC).
    const latePickup = new Date('2026-06-01T22:00:00.000Z');
    const r = resolveCompletionTimes(latePickup, {
      arrivalTime: '23:05',
      waitingMinutes: 15,
      completionTime: '01:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T22:05:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T22:20:00.000Z');
    // 01:30 is before on-board, so it rolls to the next London day.
    expect(r.dropoffAt.toISOString()).toBe('2026-06-02T00:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(15);
  });

  it('anchors an arrival typed just before a just-after-midnight pickup to the previous day', () => {
    // Pickup 00:30 London on 2 Jun (BST → 23:30 UTC on 1 Jun).
    const pickup = new Date('2026-06-01T23:30:00.000Z');
    const r = resolveCompletionTimes(pickup, {
      arrivalTime: '23:50', // driver arrived ~40 min early, i.e. the evening before
      waitingMinutes: 45,
      completionTime: '01:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T22:50:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T23:35:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(r.waitingTimeMinutes).toBe(45);
  });

  it('applies the GMT (winter) offset correctly', () => {
    // Pickup 10:00 London on 15 Jan 2026 (GMT → 10:00 UTC).
    const winterPickup = new Date('2026-01-15T10:00:00.000Z');
    const r = resolveCompletionTimes(winterPickup, {
      arrivalTime: '10:00',
      waitingMinutes: 0,
      completionTime: '10:45',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-01-15T10:00:00.000Z');
    expect(r.waitingTimeMinutes).toBe(0);
  });

  it('rejects a malformed time', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '9:5',
      waitingMinutes: 10,
      completionTime: '11:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_format');
  });

  it('rejects a negative or non-integer waiting time', () => {
    const negative = resolveCompletionTimes(summerPickup, {
      arrivalTime: '09:55',
      waitingMinutes: -1,
      completionTime: '11:30',
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.reason).toBe('bad_format');

    const fractional = resolveCompletionTimes(summerPickup, {
      arrivalTime: '09:55',
      waitingMinutes: 5.5,
      completionTime: '11:30',
    });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.reason).toBe('bad_format');
  });

  it('rejects an implausibly long wait (> 12h)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '10:00',
      waitingMinutes: 13 * 60, // 13h wait
      completionTime: '23:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('waiting_too_long');
  });
});
