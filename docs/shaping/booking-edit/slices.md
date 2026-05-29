---
shaping: true
---

# Booking Edit — Slices

Parent: [shaping.md](./shaping.md). Selected shape: **A**.

Shape A is small and tightly-coupled — A1–A7 form one vertical slice. You can't ship A1 (relax gate) without A2 (accept-time swap) or the system breaks; you can't ship without A3/A4 (notifications) or operators have to manually message everyone. So this rolls up to a single V1.

## V1: Driver swap during `assigned` state

**Demo:** operator picks a booking in `assigned`, clicks "Reassign driver", picks a different driver, gets a link, sends it to the new driver. New driver clicks accept → booking now shows new driver; old driver gets SMS'd they're off; exec gets re-SMS'd with new driver's name + car; audit shows a `driver_swap` row.

### Affordances changed/added

| Place | Affordance | Type | Change |
|---|---|---|---|
| `src/server/services/dispatch.ts` | `generateDispatchLink` | service | Accept `state ∈ {'unassigned', 'assigned'}`. When state is `'assigned'`, reject if `driverId === booking.assignedDriverId` (no-op swap). |
| `src/server/services/dispatch.ts` | `acceptDispatchLink` | service | Detect swap path (booking was `assigned` and incoming driverId differs). Atomic update gated on `state = 'assigned' AND assignedDriverId = previousDriverId`. On success: SMS old driver via new template, re-send `assignedSms` to exec, write `driver_swap` audit row. |
| `src/server/services/sms-templates.ts` | `unassignedSms(booking)` | template | New: "Booking JJ-… has been reassigned. You're no longer on it." |
| `src/server/services/audit.ts` (or wherever actions are typed) | `driver_swap` | audit action | New action type. |
| `src/components/console/dispatch-modal.tsx` | Dispatch modal | UI | When opened from `assigned` state, header reads "Reassign driver", current driver is pre-selected and visually marked as "current", picking the same driver disables submit. |
| `src/components/console/detail-panel.tsx` | "Reassign driver" button | UI | New action, visible only when `state === 'assigned'`. Opens the dispatch modal. |
| `tests/integration/services/dispatch.test.ts` | swap path tests | test | Happy: assigned→swap→accept flips driver. Unhappy: same-driver rejected, swap blocked when not `assigned`, old driver SMS'd, exec re-SMS'd, audit row written. |
| `tests/e2e/lifecycle.spec.ts` | extend lifecycle | e2e | Per CLAUDE.md §11, new state-aware action must be exercised in the lifecycle spec. Add: after initial dispatch+accept, simulator-driven swap to a second driver, assert UI reflects new driver. |

### Out of V1 (deferred per shaping doc)
- Driver re-notify on field edits (R3).
- Unified edit-modal that contains driver (R0/R1 — would be Shape B).
