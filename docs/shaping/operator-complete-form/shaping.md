---
shaping: true
---

# Operator-completed form — Shaping

> Frame: [`frame.md`](./frame.md).

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | From a booking awaiting the driver's completion form, an operator can enter the completion data (drop-off, waiting, car park) themselves and complete the booking — for when the driver is slow/unreachable and the operator gets the numbers by phone. | Core goal |
| R1 | Operator-entered completion **skips the operator-review stage** — straight to `completed`. The operator is the trusted entry point; there's nothing to self-review. | Must-have |
| R2 | It's clear — on the board/detail and in the audit trail — that the trip was **completed by the operator on the driver's behalf**, distinct from driver-submitted-then-approved. | Must-have |
| R3 | Reuses the **exact** completion fields + waiting-fee + invoicing logic as the driver form. No divergent maths. | Must-have |
| R4 | Available for **any** booking in `awaiting_driver_form` — internal or backfill driver. | Must-have |
| R5 | Low friction — reachable from the booking detail panel where the operator already is (the awaiting-form actions), not a separate screen. | Must-have |
| R6 | The driver's own link can't then double-submit (operator completion closes the booking; a late driver submit is harmlessly refused). | Must-have |
| R7 | Only available from `awaiting_driver_form` — not before the trip ends (`in_progress`), not after a driver already submitted (`awaiting_operator_review`). | Constraint |

---

## CURRENT (baseline)

| Aspect | Today |
|---|---|
| Reaching `completed` | Driver submits the signed completion form (`awaiting_driver_form → awaiting_operator_review`), then operator approves (`→ completed`). |
| `awaiting_driver_form` actions (panel) | "Generate completion link" (mint + show URL) and "WhatsApp driver". No way for the operator to enter the data. |
| Slow driver | Booking is stuck in `awaiting_driver_form` indefinitely; invoicing waits. |
| State machine | `awaiting_driver_form --driver_submit_form--> awaiting_operator_review --operator_approve--> completed`. |
| Completion data | `dropoffAt`, `waitingTimeMinutes`, `carParkPence`, `completionSubmittedAt`; `approvedAt`/`approvedByOperatorId` set at approve. Waiting fee derived live; invoicing keys on `state = 'completed'`. |
| Audit | `driver_submit_form` (actor = driver), then `operator_approve` (actor = operator). |

---

## Shapes

### A: "Complete on the driver's behalf" action from `awaiting_driver_form` — **proposed**

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **New state transition** `awaiting_driver_form --operator_complete_form--> completed` (no side effects). Distinct event from `driver_submit_form` so the path is auditable and the review stage is genuinely skipped. | |
| **A2** | **`completeFormOnBehalf()` service**: validate the same three fields (reuse the completion Zod schema), atomic update gated on `state = 'awaiting_driver_form'` → set `dropoffAt/waitingTimeMinutes/carParkPence`, `completionSubmittedAt = now`, `approvedAt = now`, `approvedByOperatorId = operator` (operator implicitly approves their own entry), `state = completed`; audit `operator_completed_form` (actor = operator); mirror. Works regardless of internal vs backfill (no driver lookup needed). | |
| **A3** | **Operator-entered marker**: persist that completion was operator-entered so R2 holds after the fact (not just derivable from audit). Lightweight boolean `completionByOperator` on `bookings` (or reuse: a non-null `completionSubmittedAt` with a null driver submit audit is fragile → prefer an explicit flag). | |
| **A4** | **Panel action + modal**: in `awaiting_driver_form`, add a secondary "Enter completion details" button beside "Generate completion link"; opens a modal with the same drop-off / waiting / car-park fields → calls A2 → toast + close. Server action `completeFormOnBehalfAction`. | |
| **A5** | **Surfacing**: the completed booking shows it was operator-entered — a small marker in the detail's completion section ("Entered by <operator> on the driver's behalf") and the history row reads accordingly; flows to audit. | |

### B: Operator submits via the driver path, then auto-approve

| Part | Mechanism |
|------|-----------|
| B1 | Reuse `submitCompletionForm` (operator triggers it), landing in `awaiting_operator_review`, then immediately call `approveBooking`. |
| B2 | Two transitions back-to-back; UI shows a brief `awaiting_operator_review` flicker; audit shows `driver_submit_form` + `operator_approve` (misattributes the entry to the driver). |

### C: Operator opens the driver's `/j/<token>` link and submits it themselves

| Part | Mechanism |
|------|-----------|
| C1 | Operator copies/opens the completion link, fills the public form. |
| C2 | Lands in `awaiting_operator_review`; operator still has to approve. No skip; clunky; audit attributes to the driver. |

---

## Fit Check

| Req | Requirement | Status | A | B | C |
|-----|-------------|--------|---|---|---|
| R0 | Operator enters completion data and completes the booking | Core goal | ✅ | ✅ | ✅ |
| R1 | Skips the operator-review stage (→ completed directly) | Must-have | ✅ | ❌ | ❌ |
| R2 | Clearly marked as operator-completed-on-behalf (UI + audit) | Must-have | ✅ | ❌ | ❌ |
| R3 | Reuses exact completion fields + waiting-fee/invoicing | Must-have | ✅ | ✅ | ✅ |
| R4 | Works for any awaiting_driver_form booking (internal or backfill) | Must-have | ✅ | ✅ | ✅ |
| R5 | Low friction, in the detail panel | Must-have | ✅ | ✅ | ❌ |
| R6 | Driver link can't double-submit afterwards | Must-have | ✅ | ✅ | ✅ |
| R7 | Only from awaiting_driver_form | Constraint | ✅ | ✅ | ✅ |

**Notes:**
- B fails R1/R2: it routes through `awaiting_operator_review` (no real skip — just an auto-click) and the audit/marker attribute the entry to the driver, not the operator.
- C fails R1/R2/R5: still requires a separate approve, attributes to the driver, and isn't a first-class panel action.
- **A selected** — a dedicated transition + service is the only shape that genuinely skips review and records the operator as the author.

---

## Decisions (resolved)

| # | Part | Decision |
|---|------|----------|
| Q1 | A3 | **Marker** — explicit `completionByOperator` boolean column on `bookings` (durable, trivial to query for the board/detail marker). One small migration. |
| Q2 | A4 | **Scope** — available **only** from `awaiting_driver_form` (R7). Not from `in_progress` (trip not finished) nor `awaiting_operator_review` (driver already submitted → use review/reject). |
| Q3 | A1 | **No reject symmetry** — the operator is entering their own data; nothing to reject. No "undo to awaiting form" path. |

## Next

Breadboarded → single vertical slice in [`slices.md`](./slices.md):
- **V1** Operator completes the form on the driver's behalf → `completed`, marked + skips review.
