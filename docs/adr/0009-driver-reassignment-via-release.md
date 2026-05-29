# 9. Driver reassignment via release-to-unassigned

Date: 2026-05-29

## Status

Accepted (supersedes the swap model added in PR #57)

## Context

A driver assigned to a booking sometimes pulls out before the trip (the typical
"~24 hours out" case). The operator needs to put a different driver on the job.

PR #57 implemented this as an **optimistic, in-place swap**: the operator picked
a new driver while the booking stayed `assigned` to the old one; only when the
new driver *accepted* did `assignedDriverId` flip and the old driver get an SMS.

This broke the system's core invariant. Everywhere else, a booking is `assigned`
**only once a driver has accepted** — a dispatch link that's been sent but not
accepted leaves the booking `unassigned` (that's the initial-dispatch flow). The
swap was the one place `assigned` could mean "nobody has confirmed":

- In the window between sending the new driver a link and them accepting, the
  board showed the job `assigned` to a driver who had already pulled out.
- It was hidden from the unassigned queue, and the 24h no-accept safety flag
  (which is `unassigned`-only) didn't apply.
- If the new driver never accepted, the job silently sat "assigned" to the
  driver who'd dropped it.

## Decision

Reassignment is a **two-step, release-first** flow:

1. **Release** — the operator clicks **"Driver pulled out — unassign"** in the
   `assigned` state. New state-machine transition `assigned --driver_released-->
   unassigned` (side effect `notify_driver_released`). The service
   (`releaseDriver`) clears `assignedDriverId`, `carForThisJob`, `assignedAt`,
   resets `flaggedAt` (so the 24h timer restarts), SMSes the dropped driver that
   they're off, and writes a `driver_released` audit row. The exec is **not**
   messaged — they only ever get a confirmation when a driver accepts.
2. **Re-dispatch** — the booking is now `unassigned`, so the standard
   "Generate dispatch link" → driver accepts (`unassigned --driver_accept-->
   assigned`) path takes over unchanged.

Consequently the bespoke swap path is removed:

- `generateDispatchLink` / `previewDispatchLink` gates revert to `unassigned`
  only; the `same_driver` reason is gone.
- `acceptDispatchLink` no longer has an `assigned → assigned` branch.
- The dispatch modal drops its "Reassign driver" title, swap hint, and the
  `CURRENT`/disabled-row handling.

## Consequences

- **`assigned` now always means "a driver has confirmed"** — one invariant, no
  phantom-driver window. During the gap the job is correctly `unassigned`:
  visible in the queue and covered by the 24h no-accept flag.
- **Less code, lower risk** — reassignment reuses the well-tested
  dispatch/accept path instead of a parallel swap implementation.
- **Trade-off:** the old driver is no longer kept as a silent fallback if the
  new one never accepts. In the pull-out case they aren't a fallback anyway, so
  this removes a misleading state rather than a useful one.
- **Workflow cost:** reassigning is two clicks (release, then dispatch) instead
  of one. Chosen deliberately — it's explicit and hard to misfire, and matches
  how operators already think ("they're off; now find someone").
