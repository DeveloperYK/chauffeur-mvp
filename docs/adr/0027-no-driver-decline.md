# 0027 — Drivers cannot decline a dispatched job

**Date:** 2026-10-18 · **Status:** Accepted

## Context

The public dispatch link (`/j/[token]`) offered two buttons: **Accept job** and
**Decline**. Decline wrote a `driver_decline` audit row and left the booking
`unassigned`. The operator asked for the decline option to go: drivers at JJ do
not get to turn a booking down through the system. A driver who genuinely
cannot do the job rings the office, and the operator offers it to someone else
— which they could already do at any time, because a dispatch link never locks
the booking.

## Decision

- Remove the **Decline** button, the `declineAction` server action, the
  `declineDispatchLink` service and the `driver_decline` domain event.
- Accept stays exactly as it was: the driver must still open the link and tap
  **Accept job** for the booking to move to `assigned`.
- `activity.ts` keeps rendering historical `driver_decline` audit rows, since
  production already holds some.

## Consequences

- The offer page has a single primary action. Nothing else in the flow changes:
  the 24 h unaccepted-link flag and the operator's ability to re-offer remain
  the safety net for a driver who ignores the link.
- `DESIGN.md` §dispatch and the risk table are updated to match.
