# ADR 0023 — "Mark as handled" for exec email reminders; driver-free confirmation

**Date:** 2026-10-15
**Status:** Accepted

## Context

Every exec-facing email is sent by hand from the booking panel (ADR 0017 /
exec-messaging). The panel, the board tile and the rail's "Send exec emails"
view all flag a booking until the confirmation and driver-details emails (and,
after a confirmed change, the booking-update email) have gone out.

Two problems surfaced in daily use:

1. **Reminders that can't be dismissed.** Operators often tell the exec by
   phone or from their own mailbox, or the trip is already under way and the
   email is moot. The flag stayed on regardless, so the "Send exec emails"
   count never reached zero and real reminders got lost in the noise.
2. **Two identical emails.** The confirmation template included the driver's
   name, car, plate, PCO and phone whenever a driver was already on the job.
   Create → assign → send both, and the exec received the driver-details
   email twice under two subjects.

## Decision

### Waiver stamps, not fake sends

Three nullable columns on `bookings` — `confirmation_email_waived_at`,
`driver_details_email_waived_at`, `change_update_email_waived_at`
(migration 0036). `waiveExecEmail` sets or clears one; both directions write an
audit row (`waive_exec_email` / `unwaive_exec_email`).

Every consumer of "is this email due?" treats a waiver exactly like a send:
`listEmailAttentionBookings` (rail view + count), `execEmailsDue` (tile tag,
hero pill) and `execEmailRows` (panel rows). The booking-update waiver is
compared against `change_confirmed_at`, so a later confirmed change re-flags
it, the same way a stale send does.

What a waiver does **not** do: it never writes to `exec_notifications` (the
message trail stays a record of what was actually sent) and it never hides a
failed delivery (`exec_notification_status = failed` still lists the booking —
that needs a resend).

UI: a flagged row gets a muted "Mark as handled" link next to "Preview &
send"; a handled row shows a grey HANDLED pill with the time and an "Undo"
link. Sending is still allowed on a handled row.

### The confirmation never carries the driver

`assignedEmail(booking)` has no driver parameter any more. It is the booking
acknowledgement (reference, passenger, date, pickup, destination). The driver
goes out only in `driverDetailsEmail`. Assigning first no longer changes what
the confirmation says.

## Consequences

- One migration, backward-compatible (nullable columns, no backfill).
- The SMS `assigned` template is untouched; SMS is not the active channel.
- A future "why was this handled?" note would be a fourth column per kind; not
  added now — the audit row carries the operator and time.
