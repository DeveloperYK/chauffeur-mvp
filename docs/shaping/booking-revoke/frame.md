---
shaping: true
---

# Booking Revoke — Frame

## Source

> Lets work on some new problems one issue is the ability to revoke a booking
> consider if an operator made a mistake how can the system handle this in a
> graceful way also think about how this reflects upon the spreadsheet

Relevant prior findings (`docs/audit/staging-audit-2026-06-28.md`):

> FINDING 6 — MEDIUM: a cancelled booking stays in the JJ backup sheet looking
> active … Decide: drop the row on cancel, or add a status/"Cancelled" marker.
> *(Resolved since by deleting the row on cancel — see CURRENT.)*

> FINDING 7 — LOW: cancel modal claims the reason is "Visible … on the Sheets
> mirror" — it isn't.

---

## Problem

Operators make ordinary mistakes: a booking keyed twice, the wrong customer
account, the wrong day, a cancel clicked on the wrong ticket, an approve pressed
on the wrong completion form. Today the only corrective tool is **Cancel**, and
it is a one-way door:

- `cancelled` is terminal. A booking cancelled by mistake cannot come back; the
  operator has to re-create it, which burns a new Job #, re-fires the exec
  confirmation from scratch, and loses the driver's acceptance.
- Cancel is only allowed from `unassigned` / `assigned` / `in_progress`. A
  booking in review, or already `completed` by a mis-click, cannot be corrected
  at all.
- Cancel conflates two very different things: "the client called it off" and
  "we should never have had this ticket". Both go through the same reason box
  and land in the same "Cancelled" list.
- Nobody is told. Cancelling sends no message to the exec or the driver; the
  driver only finds out if they happen to reopen their link.

**On the spreadsheet** (the JJ "Main Data" backup, keyed by Job #): cancelling
deletes the row outright. That keeps totals clean but means the sheet silently
loses Job numbers, a reinstated job would have to be re-inserted, and there is
no trace of *why* a row vanished. The slim layout has no status column, so the
only two options today are "row present and looks live" or "row gone".

## Outcome

An operator who makes a mistake can put it right from the console without
re-keying the booking, and the sheet ends up telling the truth about what
happened: live jobs look live, cancelled or voided jobs are either gone or
clearly marked, and Job numbers are accounted for. The exec and driver hear
about it when it matters to them.

## Out of scope

- Multi-step undo history / full "edit anything at any time" (booking edit is
  already shaped separately in `docs/shaping/booking-edit/`).
- Refunds, invoicing credit notes or any billing reversal (billing is out of MVP
  scope per `DESIGN.md` §2).
- Changing the sheet's column layout beyond what this feature needs.

## Related shaping

- `docs/shaping/booking-edit/` — correcting fields on a live booking.
- `docs/shaping/mid-flight-changes/` — driver re-confirmation after a change.
- `docs/shaping/exec-messages/` — the exec notification channel this reuses.
