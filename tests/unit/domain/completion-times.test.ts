import { resolveCompletionTimes } from '@/server/domain/completion-times';
import { describe, expect, it } from 'vitest';

describe('resolveCompletionTimes', () => {
  // Pickup 10:00 London (BST → 09:00 UTC) on 1 Jun 2026.
  const summerPickup = new Date('2026-06-01T09:00:00.000Z');

  it('resolves a normal same-day trip', () => {
    const r = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 10,
      completionTime: '11:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T10:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(10);
  });

  it('accepts 0 waiting minutes (passenger was on time)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 0,
      completionTime: '11:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T10:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(0);
  });

  it('accepts a completion at exactly the pickup time (zero-length journey)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 0,
      completionTime: '10:00',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropoffAt.toISOString()).toBe('2026-06-01T09:00:00.000Z');
  });

  it('rolls past midnight: an 11pm pickup completing at 1:30am is next-day', () => {
    // Pickup 23:00 London (BST → 22:00 UTC).
    const latePickup = new Date('2026-06-01T22:00:00.000Z');
    const r = resolveCompletionTimes(latePickup, {
      waitingMinutes: 15,
      completionTime: '01:30',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 01:30 is before the 23:00 pickup wall-clock, so it rolls to the next London day.
    expect(r.dropoffAt.toISOString()).toBe('2026-06-02T00:30:00.000Z');
    expect(r.waitingTimeMinutes).toBe(15);
  });

  it('applies the GMT (winter) offset correctly', () => {
    // Pickup 10:00 London on 15 Jan 2026 (GMT → 10:00 UTC).
    const winterPickup = new Date('2026-01-15T10:00:00.000Z');
    const r = resolveCompletionTimes(winterPickup, {
      waitingMinutes: 0,
      completionTime: '10:45',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropoffAt.toISOString()).toBe('2026-01-15T10:45:00.000Z');
    expect(r.waitingTimeMinutes).toBe(0);
  });

  it('rejects a malformed time', () => {
    const r = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 10,
      completionTime: '9:5',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad_format');
  });

  it('rejects a negative or non-integer waiting time', () => {
    const negative = resolveCompletionTimes(summerPickup, {
      waitingMinutes: -1,
      completionTime: '11:30',
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.reason).toBe('bad_format');

    const fractional = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 5.5,
      completionTime: '11:30',
    });
    expect(fractional.ok).toBe(false);
    if (!fractional.ok) expect(fractional.reason).toBe('bad_format');
  });

  it('rejects an implausibly long wait (> 12h)', () => {
    const r = resolveCompletionTimes(summerPickup, {
      waitingMinutes: 13 * 60, // 13h wait
      completionTime: '23:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('waiting_too_long');
  });
});
