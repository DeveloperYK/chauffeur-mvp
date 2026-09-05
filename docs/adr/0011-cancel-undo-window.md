# ADR 0011 — One-click cancel with a server-enforced 60 s undo

**Status:** Accepted (2026-09-05)
**Shaping:** `docs/shaping/booking-revoke/`

## Context

Operators cancel bookings for two reasons: the client called it off, or the
ticket was keyed by mistake (a duplicate, the wrong day). Both happen while the
booking is still `unassigned` or `assigned`. The old cancel demanded a ≥ 5-char
reason nobody used, and `cancelled` was a one-way door — cancelling the wrong
ticket meant re-keying it under a new Job #.

The JJ backup sheet (Google Sheets mirror) has no status column; a cancelled
booking's row is deleted by Job #.

## Decision

1. **No reason.** `cancelBookingSchema.reason` is optional; the modal is a plain
   confirm. The column stays for legacy rows and the audit log.
2. **No new state, no cancel kind.** `cancelled` remains the single terminal
   state. We record `state_before_cancel` (additive, nullable column) at cancel
   time.
3. **Undo is a real transition, time-boxed on the server.** `undo_cancel`
   moves `cancelled → state_before_cancel` and is refused unless
   `now − cancelledAt < 60 s` (`src/lib/undo-window.ts`, shared with the
   console so the toast lives exactly as long as the server will honour it).
   The console's countdown is cosmetic; the server clock is the authority.
4. **Undo does not restore lapsed driver offers.** Within 60 s no driver or exec
   has been messaged: an accepted driver is still on `assignedDriverId` so the
   booking returns to `assigned` intact; an `unassigned` booking with open
   offers comes back `unassigned` and the operator re-dispatches. This avoids
   resurrecting an offer against a driver who took another job.
5. **Sheet behaviour unchanged**: cancel deletes the row, undo re-upserts it
   under the same Job #. No status column (client decision).
6. **Scope unchanged**: cancel is still only allowed from `unassigned`,
   `assigned`, `in_progress`. No late-state cancel, no undo of Approve/Create.

## Consequences

- Legacy cancellations (no `state_before_cancel`) cannot be undone — the
  service returns `no_prior_state`.
- `isTerminal('cancelled')` is still `true` for every other purpose; only the
  `undo_cancel` event is accepted from `cancelled`.
- Toasts with an action need `pointer-events: auto` (the stack is
  `pointer-events: none` so it never blocks the board).
