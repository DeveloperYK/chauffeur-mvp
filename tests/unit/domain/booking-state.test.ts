import type { BookingState } from '@/server/db/schema';
import {
  type BookingEvent,
  canCancel,
  isTerminal,
  transition,
} from '@/server/domain/booking-state';
import { describe, expect, it } from 'vitest';

describe('booking state machine', () => {
  describe('happy-path lifecycle', () => {
    it('walks unassigned → completed', () => {
      let state: BookingState = 'unassigned';

      let t = transition(state, { type: 'driver_accept' });
      expect(t.ok && t.next).toBe('assigned');
      expect(t.ok && t.sideEffects).toEqual([{ kind: 'notify_exec_assigned' }]);
      state = (t as Extract<typeof t, { ok: true }>).next;

      t = transition(state, { type: 'clock_pickup_minus_1h' });
      expect(t.ok && t.next).toBe('in_progress');
      expect(t.ok && t.sideEffects).toEqual([{ kind: 'notify_exec_en_route' }]);
      state = (t as Extract<typeof t, { ok: true }>).next;

      t = transition(state, { type: 'clock_expected_end' });
      expect(t.ok && t.next).toBe('awaiting_driver_form');
      expect(t.ok && t.sideEffects).toEqual([{ kind: 'mint_completion_link' }]);
      state = (t as Extract<typeof t, { ok: true }>).next;

      t = transition(state, { type: 'driver_submit_form' });
      expect(t.ok && t.next).toBe('awaiting_operator_review');
      state = (t as Extract<typeof t, { ok: true }>).next;

      t = transition(state, { type: 'operator_approve' });
      expect(t.ok && t.next).toBe('completed');
    });
  });

  describe('cancellation', () => {
    it.each(['unassigned', 'assigned', 'in_progress'] as const)(
      'can be cancelled from %s',
      (state) => {
        const t = transition(state, { type: 'cancel' });
        expect(t.ok && t.next).toBe('cancelled');
      },
    );

    it('cannot be cancelled from awaiting_driver_form', () => {
      const t = transition('awaiting_driver_form', { type: 'cancel' });
      expect(t.ok).toBe(false);
    });

    it('cannot be cancelled from awaiting_operator_review', () => {
      const t = transition('awaiting_operator_review', { type: 'cancel' });
      expect(t.ok).toBe(false);
    });
  });

  describe('terminal states', () => {
    it.each(['completed', 'cancelled'] as const)('rejects any event from %s', (state) => {
      const events: BookingEvent[] = [
        { type: 'driver_accept' },
        { type: 'cancel' },
        { type: 'clock_pickup_minus_1h' },
        { type: 'operator_approve' },
      ];
      for (const e of events) {
        const t = transition(state, e);
        expect(t.ok).toBe(false);
        if (!t.ok) expect(t.reason).toBe('terminal_state');
      }
    });

    it('isTerminal()', () => {
      expect(isTerminal('completed')).toBe(true);
      expect(isTerminal('cancelled')).toBe(true);
      expect(isTerminal('assigned')).toBe(false);
    });
  });

  describe('reject path', () => {
    it('operator_reject moves awaiting_operator_review → awaiting_driver_form', () => {
      const t = transition('awaiting_operator_review', { type: 'operator_reject' });
      expect(t.ok && t.next).toBe('awaiting_driver_form');
    });
  });

  describe('decline keeps ticket unassigned', () => {
    it('decline does not move state', () => {
      const t = transition('unassigned', { type: 'driver_decline' });
      expect(t.ok && t.next).toBe('unassigned');
    });

    it('decline from any other state is illegal', () => {
      const t = transition('assigned', { type: 'driver_decline' });
      expect(t.ok).toBe(false);
    });
  });

  describe('driver released back to unassigned', () => {
    it('driver_released moves assigned → unassigned and notifies the dropped driver', () => {
      const t = transition('assigned', { type: 'driver_released' });
      expect(t.ok && t.next).toBe('unassigned');
      expect(t.ok && t.sideEffects).toEqual([{ kind: 'notify_driver_released' }]);
    });

    it.each([
      'unassigned',
      'in_progress',
      'awaiting_driver_form',
      'awaiting_operator_review',
    ] as const)('driver_released is illegal from %s', (state) => {
      const t = transition(state, { type: 'driver_released' });
      expect(t.ok).toBe(false);
    });
  });

  describe('backfill driver path', () => {
    it('backfill_assign moves unassigned → assigned and confirms the exec', () => {
      const t = transition('unassigned', { type: 'backfill_assign' });
      expect(t.ok && t.next).toBe('assigned');
      expect(t.ok && t.sideEffects).toEqual([{ kind: 'notify_exec_assigned' }]);
    });

    it('backfill_complete moves in_progress → completed directly (no driver form)', () => {
      const t = transition('in_progress', { type: 'backfill_complete' });
      expect(t.ok && t.next).toBe('completed');
      expect(t.ok && t.sideEffects).toEqual([]);
    });

    it.each([
      'assigned',
      'in_progress',
      'awaiting_driver_form',
      'awaiting_operator_review',
      'completed',
      'cancelled',
    ] as const)('backfill_assign is illegal from %s', (state) => {
      const t = transition(state, { type: 'backfill_assign' });
      expect(t.ok).toBe(false);
    });

    it.each([
      'unassigned',
      'assigned',
      'awaiting_driver_form',
      'awaiting_operator_review',
      'completed',
      'cancelled',
    ] as const)('backfill_complete is illegal from %s', (state) => {
      const t = transition(state, { type: 'backfill_complete' });
      expect(t.ok).toBe(false);
    });
  });

  describe('illegal transitions', () => {
    it.each([
      ['unassigned', 'clock_pickup_minus_1h'],
      ['unassigned', 'driver_submit_form'],
      ['assigned', 'driver_accept'],
      ['in_progress', 'driver_accept'],
      ['awaiting_driver_form', 'driver_accept'],
    ] as const)('rejects %s from %s', (state, eventType) => {
      const t = transition(state as BookingState, { type: eventType } as BookingEvent);
      expect(t.ok).toBe(false);
      if (!t.ok) expect(t.reason).toBe('illegal_transition');
    });
  });

  describe('canCancel', () => {
    it.each([
      ['unassigned', true],
      ['assigned', true],
      ['in_progress', true],
      ['awaiting_driver_form', false],
      ['awaiting_operator_review', false],
      ['completed', false],
      ['cancelled', false],
    ] as const)('canCancel(%s) = %s', (s, expected) => {
      expect(canCancel(s as BookingState)).toBe(expected);
    });
  });
});
