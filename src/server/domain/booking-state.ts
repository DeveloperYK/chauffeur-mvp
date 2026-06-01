/**
 * Pure state machine for a booking ticket.
 *
 * States and legal transitions mirror DESIGN.md §8.
 *
 *   unassigned ──(driver_accept)──► assigned
 *   unassigned ──(backfill_assign)──► assigned   (no internal driver; subcontractor covers it)
 *   unassigned ──(cancel)──► cancelled
 *
 *   assigned ──(clock_pickup_minus_1h)──► in_progress
 *   assigned ──(driver_released)──► unassigned   (driver pulled out; re-dispatch)
 *   assigned ──(cancel)──► cancelled
 *
 *   in_progress ──(clock_expected_end)──► awaiting_driver_form
 *   in_progress ──(cancel)──► cancelled
 *
 *   awaiting_driver_form ──(driver_submit_form)──► awaiting_operator_review
 *
 *   awaiting_operator_review ──(operator_approve)──► completed
 *   awaiting_operator_review ──(operator_reject)──► awaiting_driver_form
 */

import type { BookingState } from '@/server/db/schema';

export type BookingEvent =
  | { type: 'driver_accept' }
  | { type: 'driver_decline' }
  | { type: 'driver_released' }
  | { type: 'backfill_assign' }
  | { type: 'cancel' }
  | { type: 'clock_pickup_minus_1h' }
  | { type: 'clock_expected_end' }
  | { type: 'driver_submit_form' }
  | { type: 'operator_approve' }
  | { type: 'operator_reject' };

export type Transition =
  | { ok: true; next: BookingState; sideEffects: SideEffect[] }
  | { ok: false; reason: TransitionError };

export type SideEffect =
  | { kind: 'notify_exec_assigned' }
  | { kind: 'notify_exec_en_route' }
  | { kind: 'notify_driver_released' }
  | { kind: 'mint_completion_link' };

export type TransitionError = 'illegal_transition' | 'terminal_state' | 'unknown_event';

export function transition(current: BookingState, event: BookingEvent): Transition {
  switch (current) {
    case 'unassigned':
      if (event.type === 'driver_accept') {
        return {
          ok: true,
          next: 'assigned',
          sideEffects: [{ kind: 'notify_exec_assigned' }],
        };
      }
      if (event.type === 'driver_decline') {
        // Decline keeps the ticket unassigned — operator picks the next driver.
        return { ok: true, next: 'unassigned', sideEffects: [] };
      }
      if (event.type === 'backfill_assign') {
        // No internal driver was available — the operator hands the job to a
        // backfill (subcontractor) driver. Same exec confirmation as a normal
        // accept; the booking carries an isBackfill flag (no assignedDriverId).
        return {
          ok: true,
          next: 'assigned',
          sideEffects: [{ kind: 'notify_exec_assigned' }],
        };
      }
      if (event.type === 'cancel') {
        return { ok: true, next: 'cancelled', sideEffects: [] };
      }
      return { ok: false, reason: 'illegal_transition' };

    case 'assigned':
      if (event.type === 'clock_pickup_minus_1h') {
        return {
          ok: true,
          next: 'in_progress',
          sideEffects: [{ kind: 'notify_exec_en_route' }],
        };
      }
      if (event.type === 'driver_released') {
        // Driver pulled out before the trip. Back to unassigned so it re-enters
        // the dispatch queue; the dropped driver is told they're off.
        return {
          ok: true,
          next: 'unassigned',
          sideEffects: [{ kind: 'notify_driver_released' }],
        };
      }
      if (event.type === 'cancel') {
        return { ok: true, next: 'cancelled', sideEffects: [] };
      }
      return { ok: false, reason: 'illegal_transition' };

    case 'in_progress':
      if (event.type === 'clock_expected_end') {
        return {
          ok: true,
          next: 'awaiting_driver_form',
          sideEffects: [{ kind: 'mint_completion_link' }],
        };
      }
      if (event.type === 'cancel') {
        return { ok: true, next: 'cancelled', sideEffects: [] };
      }
      return { ok: false, reason: 'illegal_transition' };

    case 'awaiting_driver_form':
      if (event.type === 'driver_submit_form') {
        return { ok: true, next: 'awaiting_operator_review', sideEffects: [] };
      }
      return { ok: false, reason: 'illegal_transition' };

    case 'awaiting_operator_review':
      if (event.type === 'operator_approve') {
        return { ok: true, next: 'completed', sideEffects: [] };
      }
      if (event.type === 'operator_reject') {
        return { ok: true, next: 'awaiting_driver_form', sideEffects: [] };
      }
      return { ok: false, reason: 'illegal_transition' };

    case 'completed':
    case 'cancelled':
      return { ok: false, reason: 'terminal_state' };

    default: {
      // Exhaustiveness check
      const _exhaustive: never = current;
      void _exhaustive;
      return { ok: false, reason: 'unknown_event' };
    }
  }
}

export function isTerminal(state: BookingState): boolean {
  return state === 'completed' || state === 'cancelled';
}

export function canCancel(state: BookingState): boolean {
  return state === 'unassigned' || state === 'assigned' || state === 'in_progress';
}
