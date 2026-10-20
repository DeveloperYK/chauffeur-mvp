# 0031 — PA name + email mandatory at the operator-form boundary

Date: 2026-10-20
Status: accepted

## Context

Since ADR 0028 the booking confirmation and booking update emails are
addressed to the PA (`booked_by_email`), falling back to the exec. The client
has now said every booking comes through a PA and the PA's email must be
captured: a booking without one has nowhere to send the confirmation.

## Decision

- `bookedByErrors()` in `src/lib/booked-by-rule.ts` requires the PA's name
  and email (phone stays optional).
- It runs in `createBookingAction` and `editBookingAction`, the same place as
  the postcode rule — **not** in the `createBooking`/`editBooking` service
  schemas. Those still accept a blank PA section so the simulator seeds,
  fixtures and bookings saved before this rule keep working. A legacy booking
  is asked for the PA details the next time an operator edits it.
- The existing partial-fill refinement in the services stays as the
  service-level floor.
- No schema change: `booked_by_email` remains nullable for legacy rows.

## Consequences

- The create form cannot be submitted without the PA's name and email; the
  edit form shows the same message in its error banner.
- The exec-email fallback to the exec address is now only reached for legacy
  bookings.
