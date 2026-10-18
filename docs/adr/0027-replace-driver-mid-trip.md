# ADR 0027 — Replacing the driver while a trip is in progress

**Date:** 2026-10-18 · **Status:** Accepted

## Context

Once the clock moves a booking to `in_progress` (pickup − 1h) the console offered
no way to change the driver. Breakdowns and traffic happen in exactly that
window, and the operator has minutes, not hours, to send someone else. Swapping
(`assignDriverDirect`) and releasing (`releaseDriver`) were both gated to
`assigned`; offer links only work from `unassigned`.

## Decision

- **Swap in place; the state never leaves `in_progress`.** The trip is still
  live, so the booking must not fall back to the unassigned queue (the T−1h
  transition has already fired) and the clock keeps running towards the
  expected end. `assignDriverDirect` now accepts `in_progress` as a swap, with
  the same atomic gate on state + current driver.
- **Distinct audit action** `operator_swap_in_progress` (before/after carry
  `state: 'in_progress'`) so history shows it was an emergency replacement, not
  a routine reassign.
- **Phone only.** The operator rings a free driver and taps "Confirmed by
  phone". No fan-out links mid-trip: a WhatsApp round-trip is too slow when
  the passenger is on the kerb, and an accept flow that keeps the current
  driver on until someone accepts is a second state machine we do not need.
  User decision 2026-10-18.
- **Console.** The in-progress panel gets a red "Driver can't continue —
  replace" action (hidden for backfill jobs, which have no app driver). It
  opens the dispatch modal as "Replace driver" with a trip-in-progress callout
  and the pickup countdown, a `tel:` "Call <driver>" button for the picked
  driver, and "Confirmed by phone" as the primary action. On confirm the modal
  shows the replacement's job link (ADR 0026) so they get the address in one
  tap.
- **Side effects unchanged from a routine swap:** the dropped driver gets the
  "no longer on this booking" message, the sheet mirrors, exec emails stay
  manual. No new passenger notification (user decision: the existing
  "Message passenger (SMS)" button is enough). Backfill take-over mid-trip is
  out of scope for this cut.

## Consequences

- Completion links later sign for the replacement driver (they are the
  booking's current driver), so the trip form lands with the right person.
- Nothing records that the previous driver drove part of the trip; pay for a
  partial trip is a billing question outside the MVP.
- The lifecycle E2E replaces the driver mid-trip and asserts the state stays
  in progress and the panel shows the new driver.
