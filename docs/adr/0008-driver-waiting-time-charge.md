# 8. Driver waiting-time charge

Date: 2026-05-29

## Status

Accepted

## Context

When a driver waits beyond a reasonable grace period at pickup, that time has a
cost. The client wants the customer charged for excess waiting, and the driver
compensated for their time. The exact business rules (free period, rate, split)
will come from the client; for now we need a basic, working system with sensible
placeholders.

This **reverses** a decision made in the invoicing/reporting shaping
(`docs/shaping/invoicing-reporting.md`, R7 / Q4), which deliberately scoped v1's
charge model to *"contract price + car park, no waiting charge"*. That kept the
first invoicing slice small; waiting charging is the intended next step.

Relevant existing state:

- The driver completion form already captures `waitingTimeMinutes` (recorded for
  audit only — never charged).
- There is **no driver-pay / earnings model** anywhere in the system. Bookings
  only track the customer-facing `contractPricePence` + `carParkPence`.
- Money is stored as integer pence; charges are computed as pure domain logic.

## Decision

Introduce a pure domain module `src/server/domain/waiting-fee.ts` with a single
config constant and a pure function:

```
WAITING_FEE_RULES = { freeMinutes: 30, perMinutePence: 50, driverSharePercent: 70 }
waitingFee(minutes) → { waitingMinutes, chargeableMinutes,
                        customerFeePence, driverPayPence, companyMarginPence }
```

- **Chargeable minutes** = `max(0, minutes − freeMinutes)`.
- **Customer fee** = `chargeableMinutes × perMinutePence`.
- **Driver pay** = `round(customerFee × driverSharePercent / 100)`; the company
  margin absorbs the rounding remainder so `driverPay + margin === customerFee`.

Decisions taken with the client's proxy (placeholders until real rules arrive):

1. **Customer rate:** 30 min free, then £0.50/min. A placeholder, mirroring
   `PLACEHOLDER_PRICING_RULES` — replace the one constant when the rate card lands.
2. **Driver compensation:** the driver receives a **percentage share** (default
   **70%**) of the customer waiting fee. This is the *first* notion of driver pay
   in the system; it is surfaced as a **displayed figure only** — not a payroll
   system, no money is moved or stored.
3. **Computed live, not snapshotted.** The fee is derived from the stored
   `waitingTimeMinutes` every time it is shown — no new DB columns, no migration.
   Changing the rules re-prices everywhere consistently (including historical
   invoices). This matches how invoicing already works (a live derived view).

Surfaced in:

- **Operator review panel** — a "Waiting charge" row shows the customer fee,
  chargeable minutes, and the driver's share, so operators see exactly what is
  billed and what the driver earns before approving.
- **Driver completion form** — the field formerly labelled "Car park / waiting
  fee (£)" is relabelled **"Car park (£)"** (waiting is now auto-computed from
  minutes, so the old label would double-charge), plus a one-line policy note
  rendered from the config.
- **Invoicing reconciliation** — line total becomes
  `contract + car park + waiting`, with a new **Waiting (£)** column in the CSV.
- **Google Sheets mirror** — the previously-empty **Waiting (£)** column (X) is
  populated. Net Due / VAT / Total (Y/Z/AA) remain blank for the sheet's own
  formulas, as before.

## Consequences

- **Positive:** A working waiting charge with a single, obvious place to update
  when the client confirms the rules. No schema change, fully reversible. The
  fee is consistent across the review panel, invoicing, and the sheet because it
  flows from one pure function.
- **Trade-off (live compute):** changing `WAITING_FEE_RULES` re-prices past
  bookings. Acceptable while rules are placeholders and invoicing is a live
  report (not a frozen ledger). If/when invoices become durable records, revisit
  and snapshot the fee at completion time.
- **Driver pay is display-only.** Introducing real payroll (statements, payouts)
  is out of scope and would be a separate decision.
- Updates the invoicing shaping doc's R7/Q4 (recorded there as superseded).
