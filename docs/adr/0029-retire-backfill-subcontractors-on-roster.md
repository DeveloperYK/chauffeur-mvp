# ADR 0029 — Retire the backfill hand-off: subcontractors live on the roster

**Date:** 2026-10-20 · **Status:** Accepted

## Context

The backfill flow (ADR-less, shaped in `docs/shaping/backfill-drivers`) let an
operator hand an unassigned booking to a subcontractor typed in as free text —
name, phone, car and a per-job pay — with no `drivers` row. The booking then
ran the normal lifecycle with `assigned_driver_id` null and an `is_backfill`
flag, and every driver-facing path (completion link, exec emails, the sheet,
the panel, the mobile shell, search) carried a second branch for it.

The client has decided to add their subcontractor drivers to the system as
ordinary drivers. They have a couple of full-time drivers and a number of
subcontractors, and they know which is which; they do not want a flag or a
separate flow.

## Decision

1. **Subcontractors are drivers.** They are created on the Drivers screen like
   anyone else and dispatched, assigned by phone, swapped and replaced through
   the same actions. No `is_subcontractor` flag, no per-driver pay.
2. **The backfill flow is removed**, not hidden: the `backfill_assign`
   transition, `services/backfill.ts`, the "Hand to backfill" button and
   modal, the "Backfill pay" row, the BACKFILL lozenges, the completion-token
   nil-UUID sentinel, and every `isBackfill` branch in services, the sheet
   mapping, the panel, the board, the mobile shell and search.
3. **History is folded into the roster (migration 0038).** Each distinct
   subcontractor phone on a legacy backfill booking becomes an *inactive*
   driver (reusing an existing driver with that WhatsApp number), the booking
   is assigned to it (operator-attested), and the recorded backfill pay fills
   `subcontractor_price_pence` when no price was agreed. Inactive keeps them
   out of dispatch until an operator reviews the row; the operators can
   activate and complete it. The migration is idempotent and covered by
   `tests/integration/db/backfill-to-drivers-migration.test.ts`, which runs
   the real SQL against legacy-shaped rows.
4. **The legacy columns stay in the database, unread.** `is_backfill`,
   `backfill_driver_name/phone`, `backfill_car`, `backfill_driver_pay_pence`
   are dropped from the Drizzle schema but not from Postgres, so the deploy is
   backward-compatible and the data migration is reversible. A follow-up
   migration may drop them once the operators have confirmed the converted
   bookings look right.
5. **The sheet's Driver Type (N) is blank; Driver Cost (O) is the
   subcontractor price.** The roster no longer says who is an employee, and the
   client already knows. The quote captured at booking time replaces the
   hand-off pay in Driver Cost — it is what the pay used to default to.
6. **Audit labels for old `hand_to_backfill` events stay** so earlier
   bookings' history still reads sensibly.

## Consequences

- One lifecycle for every driver; fewer branches to test. The lifecycle E2E's
  subcontractor arm now exercises the driver completion link on a normal
  assigned booking.
- The "Subcontractor price" field on the booking stays as the agreed cost of
  a job given to a subcontractor driver; it is informational and feeds the
  sheet.
- DESIGN.md §2's "no backfill subcontractor workflow" is once again true.
- Rollback: redeploy the previous build; the columns are intact. To undo the
  data step, see the comment at the top of `drizzle/0038_backfill_to_drivers.sql`.
