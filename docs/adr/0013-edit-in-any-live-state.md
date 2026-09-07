# ADR 0013 — A booking is editable in every state except `cancelled`

**Status:** Accepted (2026-09-07)
**Supersedes:** `docs/shaping/booking-edit` R6 (edit blocked on `completed`)

## Context

The original edit rule closed the booking once it was `completed`, and the
console only surfaced the Edit button while `unassigned` / `assigned`. Real
operations do not stop at dispatch: an exec in the car asks to be taken
somewhere else, an extra stop is added, a flight changes while the driver is
en route. After the trip, the record is corrected before invoicing (the actual
destination, a note about the extra leg, a contact detail). The service already
allowed edits in `in_progress` and the `awaiting_*` states; the UI hid them,
and `completed` was refused outright.

## Decision

1. **One rule: editable unless cancelled.** `editBooking` refuses only
   `cancelled` (undo-cancel is the way back in). The Edit button appears in
   the detail panel for every other state, including `completed`.
2. **Driver re-confirmation flags only while the trip is live.** The
   mid-flight `change pending` flag (ADR / shaping `mid-flight-changes`) is
   set for driver-facing edits in `assigned` and `in_progress` only. Once the
   trip is over (`awaiting_driver_form`, `awaiting_operator_review`,
   `completed`) there is no plan left to confirm, so post-trip edits never
   flag and never disturb an existing confirmation.
3. **Same side effects everywhere.** Every effective edit writes an `edit`
   audit event and re-mirrors the row to the backup sheet; a no-op edit writes
   neither. Post-completion edits carry no exec message: the "Booking update"
   email stays manual and driven by the change-confirmation flow.

## Consequences

- A completed booking's price, addresses and notes can be corrected in place
  before invoicing; the audit log holds the changed-field list per edit.
- The completion data (arrival / on-board times, car park, waiting charge) is
  not part of the edit modal; it keeps its own controls on the panel.
- Cancelled remains the only immutable state, matching `setContractPrice`.
