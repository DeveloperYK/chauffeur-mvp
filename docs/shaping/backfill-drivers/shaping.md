---
shaping: true
---

# Backfill Drivers — Shaping

> Frame: [`frame.md`](./frame.md). Selected shape: **B** (booking-level, free-text,
> manual close-out).

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | When no internal driver is available, an operator can hand a booking to a backfill (subcontractor) driver and the system tracks it through to **completed** — not ghosted in `unassigned`. | Core goal |
| R1 | Backfill drivers stay **separate from the internal roster** — they don't appear in or skew the normal "Find a driver" ranking, availability, or drivers list. | Must-have |
| R2 | The operator records **who is covering** the job — at minimum name + contact + vehicle — so the booking shows a real driver, not a blank. | Must-have |
| R3 | The **exec experience is unchanged** — same assignment + en-route confirmations, naming the backfill driver/car. | Must-have |
| R4 | The group chat + 👍 + vetting **stays manual** (outside the system) for MVP — the system records the outcome, it doesn't orchestrate the chat. | Constraint (non-goal) |
| R5 | 🟡 Backfilled jobs are **clearly marked** — at a glance **on the board tile** (live) and afterwards in audit/reporting/invoicing. | Must-have |
| R6 | Completion data (drop-off / waiting / car park) still gets captured so **invoicing reconciles**, and it works **even if the subcontractor won't use our driver completion link** — i.e. the operator can enter it. | Must-have |
| R7 | A **one-off** backfill driver is trivial to enter. (Reuse of repeat subs is **deferred** — not in this MVP.) | Nice-to-have (deferred) |
| R8 | **Low friction** — reachable from where the operator already is (the unassigned booking / "Find a driver" flow), not a separate subsystem. | Must-have |

🟡 R6 reframed (was "Undecided"): operator-entered completion, no link dependency — satisfied by Shape B.
🟡 R7 downgraded to Nice-to-have (deferred): Shape B trades reuse away for simplicity.

---

## CURRENT (baseline)

| Aspect | Today |
|---|---|
| No driver available | Operator leaves the system: posts to WhatsApp group, vets by hand. Booking stays `unassigned` or is force-cancelled. |
| Lifecycle | `unassigned → assigned → in_progress → awaiting_driver_form → awaiting_operator_review → completed`. Driven by signed driver links + the clock. |
| `assigned` invariant | Means **an internal driver tapped Accept** on a signed link (reinforced by #61's release-to-unassigned). `assignedDriverId` FK → `drivers`. |
| Exec messages | Assignment confirmation fires on driver **accept**; en-route fires on clock `assigned → in_progress`; both name `drivers.name` / `carForThisJob`. |
| Completion | Driver submits the signed completion form (drop-off, waiting, car park) → operator reviews → completed. |
| Identifiability | Every job has a `drivers` row; there is no "ran without one of our drivers" concept. |

---

## Shapes

### A: Backfill driver as an ad-hoc driver record
| Part | Mechanism |
|------|-----------|
| A1 | `drivers.kind = 'backfill'` (or a flag); excluded from "Find a driver" ranking + drivers list. |
| A2 | Quick "add backfill driver" (name/phone/car) inside the dispatch flow; record persists (reusable). |
| A3 | Reuse the **entire** existing lifecycle: signed accept link → completion form → review → completed. |

### B: Backfill as a booking-level outcome (free-text, no driver record) — **SELECTED**

State model (Q1): **reuse `assigned`/`in_progress`/`completed` + an `isBackfill` flag**, `assignedDriverId` null. Transitions (Q2): **clock-driven**, like internal jobs.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **B1** | **Backfill fields on `bookings`**: `isBackfill` bool + `backfillDriverName`, `backfillDriverPhone`, `backfillCar`. Migration. `assignedDriverId` stays null. | |
| **B2** | **"Hand to backfill" action** from `unassigned`: form (name / phone / car) → sets B1 fields, transitions `unassigned → assigned` with `isBackfill=true` via a **new `backfill_assign` event** (side effect `notify_exec_assigned`), and fires the exec **assignment** message. Breadboard note: `assignedSms()` currently takes a `Driver` row → **adapt it to take the backfill name/car**. | |
| **B3** | **Clock-driven en-route**: clock-tick treats a backfill `assigned` job like any other → `assigned → in_progress` at pickup + auto en-route exec message (`enRouteSms()` likewise **adapted** for backfill name). | |
| **B4** | **Completion — identical to an internal driver** (revised during build). Originally a manual operator "close-out" that skipped straight to `completed`; changed so backfill follows the **exact normal flow**: clock advances `in_progress → awaiting_driver_form`, the operator generates a completion link and WhatsApps it to the backfill driver, who fills the **same** completion form → `awaiting_operator_review` → operator approve → `completed`. The completion link is signed with a nil-UUID sentinel driver id (backfill has no `drivers` row). No `backfill_complete` event, no clock guard. | |
| **B5** | **Surfacing**: 🟡 a `BACKFILL` lozenge on the **board card tile** + list row (at-a-glance, R5), showing the backfill driver name where a normal driver tag would go; a "covered by" panel in the detail; driver-only actions (Find a driver / dispatch link / completion link) hidden when `isBackfill`; excluded from driver-keyed views (R1); `isBackfill` flows to audit + invoicing. | |

### C: Hybrid — lightweight subcontractor roster + manual close-out
| Part | Mechanism |
|------|-----------|
| C1 | Separate `subcontractors` roster (reuse repeat subs). |
| C2 | Optionally send a signed link (sub may accept) **or** operator closes out manually. |
| C3 | Both paths reach `completed` + flag the job as backfill. |

---

## Fit Check

| Req | Requirement | Status | A | B | C |
|-----|-------------|--------|---|---|---|
| R0 | Hand to backfill driver; tracked through to completed | Core goal | ✅ | ✅ | ✅ |
| R1 | Backfill drivers separate from internal roster | Must-have | ✅ | ✅ | ✅ |
| R2 | Record who is covering (name + contact + vehicle) | Must-have | ✅ | ✅ | ✅ |
| R3 | Exec experience unchanged (assignment + en-route msgs) | Must-have | ✅ | ✅ | ✅ |
| R4 | Group chat + vetting stays manual | Constraint | ✅ | ✅ | ✅ |
| R5 | Backfilled jobs clearly marked (board tile + afterwards) | Must-have | ✅ | ✅ | ✅ |
| R6 | Completion captured even if sub won't use our link | Must-have | ❌ | ✅ | ✅ |
| R7 | One-off trivial (reuse deferred) | Nice-to-have | ✅ | ✅ | ✅ |
| R8 | Low friction, in the existing flow | Must-have | ✅ | ✅ | ✅ |

**Notes:**
- A fails R6: A relies on the subcontractor tapping our signed completion link; if they won't (the common case for an external one-off), A has no capture path.
- B and C both pass; **B selected** — C's roster (reuse) is deferred per R7, so the extra build isn't justified for MVP.

---

## Decisions (resolved)

| # | Part | Decision |
|---|------|----------|
| Q1 | B2/B4 | **State model** — reuse `assigned`/`in_progress`/`completed` + an `isBackfill` flag; no new enum value. `assignedDriverId` stays null; driver-only actions are flag-gated off. |
| Q2 | B3 | **Transitions** — clock-driven, like internal jobs: en-route fires automatically at pickup, and `in_progress → awaiting_driver_form` at expected end (no special guard). |
| Q3 | B4 | **Completion path** (revised during build) — **identical to an internal driver**: the backfill driver fills the same completion form via a WhatsApp link → `awaiting_operator_review` → operator approve → `completed`. (The original manual operator close-out that skipped these states was dropped.) |

## Next

Breadboarded → **3 vertical slices** in [`slices.md`](./slices.md):
- **V1** Hand to backfill → Assigned + marked (B1, B2, B5)
- **V2** Clock-driven en-route (B3)
- **V3** Completion via the normal driver form → review → approve (B4)

New state-machine transitions B introduces (gated on `isBackfill`):
- `unassigned → assigned` (no driver; via "Hand to backfill")
- (completion reuses the existing `driver_submit_form` / `operator_approve` path — no new transition)
- clock guard: `in_progress` (backfill) does **not** auto-advance to `awaiting_driver_form`
