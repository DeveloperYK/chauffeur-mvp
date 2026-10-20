# ADR 0028 — Exec email recipients: the PA, the exec, and CC

**Date:** 2026-10-20 · **Status:** Accepted

## Context

Every operator-sent exec email (booking confirmation, driver details, booking
update) went to one address: the booking's `exec_email`. In practice most
bookings are made by a PA on the exec's behalf, and the PA is who wants the
confirmation; the exec only needs the driver's details on the day. Operators
were retyping the To address on each send, and had no way to copy anyone.

## Decision

1. **Defaults by email kind.** The confirmation and the booking update are
   addressed to the PA (`booked_by_email`) when one is on file, else the exec.
   The driver details are addressed to the exec, with the PA copied by default.
   A booking with only one address uses it for everything. The rule lives in
   `execEmailRecipients()` in `src/server/services/exec-notifications.ts` and
   only sets the draft; the operator can change To, untick the copy, or add
   addresses on every send. Nothing is remembered per booking.
2. **One-tick copy of the counterpart.** The draft names the other party
   (`copyTo`: the exec when the PA is the To, the PA when the exec is) so the
   send form shows a single "Also send to the PA/exec (address)" checkbox
   instead of a free-text field the operator has to fill. The counterpart is
   never offered when it is the same address as the To.
3. **CC, not separate sends.** Copies go as real CC recipients on one provider
   call. `EmailMessage.cc` is added to the port, both adapters (Resend passes
   the array through; the fake records it) reject a malformed CC address with
   `invalid_cc`, and the contract test covers both. At most 5 CC addresses per
   send; the list is lower-cased, de-duplicated, and the To address is removed
   from it on the server, so the UI cannot produce a double delivery.
4. **Recorded, not inferred.** `exec_notifications.cc text[]` (migration 0037)
   stores who was copied; the panel's message trail and the audit event show
   it. Delivery status stays per message (one Resend id), so a bounce on a CC
   address is not distinguished from the To — Resend reports one status per
   email, and the operator sees the address list to work it out.

## Consequences

- The email-due flags and the "Emails due" view are unchanged: they key on
  the email kind having been sent, not on who received it.
- SMS rows and pre-existing email rows carry an empty `cc`.
- A booking with no `booked_by_email` behaves exactly as before.
- Rollback: `ALTER TABLE exec_notifications DROP COLUMN cc`.
