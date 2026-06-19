import { resolveCompletionTimes } from '@/server/domain/completion-times';
import { describe, expect, it } from 'vitest';

describe('resolveCompletionTimes', () => {
  // Pickup 10:00 London (BST → 09:00 UTC) on 1 Jun 2026.
  const summerPickup = new Date('2026-06-01T09:00:00.000Z');

  it('resolves a normal same-day trip and derives waiting from arrival→on-board', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '09:55',
      passengerOnBoardTime: '10:05',
      completionTime: '11:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.arrivalAt.toISOString()).toBe('2026-06-01T08:55:00.000Z');
    expect(r.passengerOnBoardAt.toISOString()).toBe('2026-06-01T09:05:00.000Z');
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T10:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('rolls past midnight: an 11pm pickup completing at 1:30am is next-day', () => {
    // Pickup 23:00 London (BST → 22:00 UTC).
    const latePickup = new Date('2026-06-01T22:00:00.000Z');
    const r = resolveCompletionTimes(latePickup, {
      arrivalTime: '23:05',
      passengerOnBoardTime: '23:20',
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
      passengerOnBoardTime: '00:35',
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
      passengerOnBoardTime: '10:00',
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
      passengerOnBoardTime: '10:05',
      completionTime: '11:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_format');
  });

  it('accepts a long wait without capping it (operator reviews)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '10:00',
      passengerOnBoardTime: '23:00', // 13h wait, same day — no longer rejected
      completionTime: '23:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.waitingTimeMinutes).toBe(13 * 60);
  });

  it('accepts out-of-order times rather than blocking the submission', () => {
    // on-board before arrival rolls on-board to the next day → a long wait,
    // which the operator can correct on review instead of being blocked here.
    const r = resolveCompletionTimes(summerPickup, {
      arrivalTime: '14:00',
      passengerOnBoardTime: '13:55',
      completionTime: '14:30',
    });
    expect(r.ok).toBe(true);
  });
});
