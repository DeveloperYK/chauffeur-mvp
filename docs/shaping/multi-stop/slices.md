---
shaping: true
---

# Multi-stop trips — Slices

Source: `shaping.md` (Detail B). Each slice ends in something an operator or driver can see.

| # | Slice | Parts | Affordances | Demo |
|---|-------|-------|-------------|------|
| V1 ✅ #260 | Stops on the booking | B1, B2, B3, B8 | U1–U5, U7, N1–N3, N5, N6, N10, N14, N15, N16, S1–S4 | Create a transfer with two stops and a 40-min wait; the estimate line rolls up legs + wait; the panel hero, board tile and list row read "Home → City (wait 40m) → LHR"; search finds the stop address; Copy booking carries the stops |
| V2 ✅ | Driver sees the route | B4 | U8, U13, U14, N8, N9 | Dispatch it; the WhatsApp message, the job link page and the calendar entry list the stops with "wait ~40 min" |
| V3 | Exec emails show the route | B5 | U12, N7 | Preview the confirmation and driver-details emails: a Route block replaces the Pickup/Destination rows |
| V4 | Edit and change-confirm | B6 | U6, U15, N4 | After assignment, add a stop in Edit; the driver-not-told flag appears, the change link shows the new route, confirming clears it, and the update email is due |
| V5 | Completion per stop | B9 | U9, U10, U11, N11, N12, N13 | Driver completion form asks Arrived/Left per stop; waiting is the sum; the review card shows the per-stop times and the sheet's Waiting columns carry the total. Lifecycle E2E extended to walk a two-stop booking end to end |

Order: V1 → V2 → V3 → V4 → V5. V1 includes migration `0039_booking_stops`. Each slice is one PR (`feat/multi-stop-vN-<slug>`), shipped with `pnpm ship`.

Per-slice plans (`V1-plan.md` …) are written when each slice starts.
