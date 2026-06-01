---
shaping: true
---

# Operator-completed form (on the driver's behalf) — Frame

## Source

> I want to implement a system where operators can fill out the completion form
> on behalf of drivers. Consider scenarios where the driver is taking a long
> time so operators call them up to get the information. When this happens it
> should make sense on the UI and skip the operator review stage.

---

## Problem

Once a trip ends the booking sits in `awaiting_driver_form`, waiting for the
driver to open their signed link and submit drop-off time / waiting minutes /
car park. Drivers are often slow or unresponsive — so the operator phones them,
gets the three numbers verbally, and… has nowhere to put them. Today the only
paths to `completed` are:

- the **driver** submits the form (`awaiting_driver_form → awaiting_operator_review`),
  then the operator **approves** it (`→ completed`); or
- nothing — the booking is stuck until the driver acts.

So a slow driver blocks completion (and therefore invoicing). The operator-review
stage exists to catch driver-entered data; when the **operator** is the one
entering the data (from the call), reviewing their own entry is redundant.

## Outcome

From a booking that's awaiting the driver's form, an operator can enter the
completion data themselves and complete the booking in one step — **skipping the
operator-review stage**. It's clear on the board and in the audit trail that the
trip was completed by the operator on the driver's behalf, not driver-submitted.
Same fields, same waiting-fee/invoicing maths as the driver form.

## Out of scope

- Editing a form the driver **already** submitted (that's the existing
  review/reject flow).
- Completing before the trip has ended (`in_progress`) — the form is only
  meaningful once the job is done and the booking is `awaiting_driver_form`.
- Any change to the driver's own link/submit path — it keeps working unchanged.

## Related

- `docs/shaping/backfill-drivers/` — backfill jobs reach `awaiting_driver_form`
  the same way; this feature applies to them too (a backfill driver can be just
  as slow). An earlier backfill-only "operator close-out" was built then dropped
  in favour of backfill drivers using the normal form; this generalises the idea
  to **all** drivers and, crucially, only from `awaiting_driver_form`.
