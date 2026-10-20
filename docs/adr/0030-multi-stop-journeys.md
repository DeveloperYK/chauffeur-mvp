# ADR 0030 — Multi-stop journeys: ordered stops on one booking

**Date:** 2026-10-20 · **Status:** Accepted — all five slices shipped 2026-10-20 (#260, #262, #264, #266, V5)

## Context

A booking was pickup → one drop-off (transfer) or hourly as-directed with no
destination. Real jobs often need "take me to A, wait 40 minutes, then B, then
back" or a pit-stop on the way. Operators booked these as hourly (losing the
destinations everywhere) or as several bookings (duplicate dispatch, emails,
completion forms). DESIGN.md §2 listed multi-leg trips as out of scope; the
user asked for this explicitly on 2026-10-20. Shaped in
`docs/shaping/multi-stop/` (shape B).

## Decision

1. **One booking, ordered stops.** `booking_stops` (migration 0039) holds the
   intermediate stops of a transfer: `seq` from 1, `address`, optional
   `place_id`, `planned_wait_minutes` (0–720), and `arrived_at` /
   `departed_at` for what the driver records on completion. Pickup and
   destination stay on `bookings`. Stops cascade with the booking. The list is
   always written whole (`replaceStops`), never patched.
2. **Transfer only.** The create (and later edit) schema rejects stops on an
   hourly booking; switching the form to As-directed clears them. Max 8 stops.
3. **Planned waits are scheduling, actual waits are money.** The planned wait
   is shown to the driver as an estimate ("wait ~40 min") and added to the
   booking's duration so the clock's expected end is right. The chargeable
   waiting (slice V5) is the sum of the recorded pickup wait and each stop's
   `departed_at − arrived_at`, through the existing £1/min rule and override.
4. **Route estimate across legs.** One Directions request with the stops as
   `waypoints` (`lib/routes.ts`); `distance_meters` = Σ legs, duration =
   Σ drive + Σ planned waits. The sheet's Mileage therefore shows total miles.
5. **The sheet is unchanged.** Address From / To are the first pickup and the
   final destination; stops are not mirrored (user decision).
6. **Every stop obeys the postcode rule** at the server-action boundary, with
   errors keyed `stops.<i>.address` / `stops.<i>.postcode`.
7. **A return to origin is just a destination equal to the pickup.** No
   special option.

## Consequences

- V1 (this PR): schema + service, create form stops editor, estimate roll-up,
  route summary on board tile / list row / panel, search over stop addresses,
  Copy booking carries stops.
- V2–V5 (next PRs): driver link + messages + calendar; exec email Route block;
  edit + change-confirm; completion per stop with the summed waiting and the
  lifecycle E2E walking a two-stop booking.
- `ConsoleBooking.stops` is loaded with every console read model
  (`listStopsForBookings`, one query per page), never N+1.
- Rollback: `DROP TABLE booking_stops`; the form fields simply disappear.
