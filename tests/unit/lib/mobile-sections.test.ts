import { attentionReason, sectionBookingsForDay } from '@/lib/mobile-sections';
import type { BookingState, ChangeConfirmationStatus } from '@/server/db/schema';
import { describe, expect, it } from 'vitest';

function b(
  id: string,
  state: BookingState,
  pickupAt: string,
  extra: { change?: ChangeConfirmationStatus; offers?: number } = {},
) {
  return {
    id,
    state,
    pickupAt,
    changeConfirmationStatus: extra.change ?? 'none',
    openOffers: Array.from({ length: extra.offers ?? 0 }, (_, i) => ({
      driverId: `d${i}`,
      driverName: `Driver ${i}`,
    })),
  };
}

describe('lib/mobile-sections sectionBookingsForDay', () => {
  it('puts unassigned and awaiting-review bookings under attention, sorted by pickup', () => {
    const out = sectionBookingsForDay([
      b('late', 'unassigned', '2026-10-13T10:00:00Z'),
      b('early', 'awaiting_operator_review', '2026-10-13T06:00:00Z'),
    ]);
    expect(out.attention.map((x) => x.id)).toEqual(['early', 'late']);
    expect(out.scheduled).toEqual([]);
    expect(out.done).toEqual([]);
  });

  it('flags a dispatched booking whose driver has not confirmed a change', () => {
    const out = sectionBookingsForDay([
      b('changed', 'assigned', '2026-10-13T10:00:00Z', { change: 'pending' }),
      b('fine', 'assigned', '2026-10-13T09:00:00Z'),
    ]);
    expect(out.attention.map((x) => x.id)).toEqual(['changed']);
    expect(out.scheduled.map((x) => x.id)).toEqual(['fine']);
  });

  it('keeps live jobs under scheduled in pickup order', () => {
    const out = sectionBookingsForDay([
      b('c', 'awaiting_driver_form', '2026-10-13T12:00:00Z'),
      b('a', 'assigned', '2026-10-13T08:00:00Z'),
      b('b', 'in_progress', '2026-10-13T09:30:00Z'),
    ]);
    expect(out.scheduled.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('moves completed and cancelled bookings to done', () => {
    const out = sectionBookingsForDay([
      b('x', 'completed', '2026-10-13T08:00:00Z'),
      b('y', 'cancelled', '2026-10-13T07:00:00Z'),
    ]);
    expect(out.done.map((x) => x.id)).toEqual(['y', 'x']);
    expect(out.attention).toEqual([]);
  });

  it('returns three empty sections for an empty day', () => {
    expect(sectionBookingsForDay([])).toEqual({ attention: [], scheduled: [], done: [] });
  });

  it('does not mutate the input order', () => {
    const input = [
      b('2', 'assigned', '2026-10-13T10:00:00Z'),
      b('1', 'assigned', '2026-10-13T09:00:00Z'),
    ];
    const snapshot = input.map((x) => x.id);
    sectionBookingsForDay(input);
    expect(input.map((x) => x.id)).toEqual(snapshot);
  });
});

describe('lib/mobile-sections attentionReason', () => {
  it('names why a booking needs the operator', () => {
    expect(attentionReason(b('1', 'unassigned', '2026-10-13T10:00:00Z'))).toBe('Needs a driver');
    expect(attentionReason(b('1', 'unassigned', '2026-10-13T10:00:00Z', { offers: 2 }))).toBe(
      'Offered to 2 · awaiting reply',
    );
    expect(attentionReason(b('1', 'awaiting_operator_review', '2026-10-13T10:00:00Z'))).toBe(
      'Review completion',
    );
    expect(attentionReason(b('1', 'assigned', '2026-10-13T10:00:00Z', { change: 'pending' }))).toBe(
      'Driver not told of change',
    );
  });
  it('is null for bookings that are fine', () => {
    expect(attentionReason(b('1', 'assigned', '2026-10-13T10:00:00Z'))).toBeNull();
    expect(attentionReason(b('1', 'completed', '2026-10-13T10:00:00Z'))).toBeNull();
  });
});
