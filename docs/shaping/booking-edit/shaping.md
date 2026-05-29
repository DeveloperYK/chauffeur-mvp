---
shaping: true
---

# Booking Edit — Shaping

## Source

> The next piece of work I want to tackle is an editing feature for bookings — we should be able to edit bookings: pickup, destination, driver, etc. In a clear, professional way that is consistent with our existing UX/UI.
>
> For example if the operator makes a mistake (i.e. phone number needs changing) — think of all the use cases where something might need changing.

---

## Problem

After a booking is taken, operators routinely need to correct or amend it: the caller misheard a phone number, the exec moved the pickup by 30 minutes, the customer account was tagged wrong, the driver is unavailable and someone else needs to take the trip. Today these changes are split across three modals with different mental models and different side-effect behavior:

- **Edit modal** — fields only, no SMS side effects, blocked once `completed`/`cancelled`.
- **Dispatch modal** — driver assignment via signed link (driver accepts).
- **Cancel modal** — terminal state change.

Worse: when a field that the *driver was told about* changes (pickup time, pickup address, exec mobile), nobody currently re-notifies. Operators must remember to message the driver out-of-band. Editing isn't really finished — it's editing in the DB only.

## Outcome

Operators have a single, predictable editing surface that:
- exposes every field that can sensibly be amended,
- makes state-dependent constraints visible (what can/can't be changed *now*, and why),
- handles the downstream consequences of a change (driver re-notification, sheet mirror, audit) so the operator doesn't have to.

---

## CURRENT

What exists today:

| Surface | What it covers |
|---|---|
| `editBooking` service + `EditBookingModal` | serviceType, pickupAt, expectedDurationMinutes, distanceMeters, pickup/dropoff address, passenger first/last name, execMobile, customerAccount, caseCode, contractPricePence, notes. Writes DB + mirror + audit. **No SMS.** Blocked when state ∈ {completed, cancelled}. |
| `dispatch` service + `DispatchModal` | Generate signed driver link → driver accepts → booking gets driverId + state moves to `assigned`. |
| `cancel` service + `CancelModal` | Terminal cancellation. |

**Gaps observed in CURRENT (confirmed with user):**
- **No driver swap exists at all.** `generateDispatchLink` rejects unless `state === 'unassigned'` (dispatch.ts:62). Once a driver has accepted, there is no in-app way to put a different driver on the job. Operators handle drop-outs on WhatsApp and the system shows the wrong driver. This is the biggest gap.
- Editing pickup time / address / exec mobile after dispatch does NOT re-notify the assigned driver (edit-booking.ts has no `notifications` dep).
- The exec was previously SMS'd with the assigned driver's name + car (`assignedSms`); any driver-swap implicitly invalidates that message too — exec needs to know.
- "What can I edit right now?" is implicit — operator has to try and see.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Operator can correct any field on a booking that could be wrong, from a single editing surface | Core goal |
| R1 | Edit-driver (reassign / unassign) is reachable from the same surface as edit-fields | Must-have |
| R2 | Operator can see, before they try, which fields are editable in the booking's current state and why others aren't | Must-have |
| R3 | When a change affects something the driver was already told (time, pickup, dropoff, exec mobile), the assigned driver is re-notified — operator doesn't have to remember | Must-have |
| R4 | Every edit writes an audit row capturing actor + before/after + which fields changed (CURRENT already does this for field edits) | Must-have |
| R5 | Sheet mirror reflects the edit on the same write (CURRENT already does this) | Must-have |
| R6 | Editing is blocked on terminal states (`completed`, `cancelled`) with a clear reason shown to the operator | Must-have |
| R7 | Visual + interaction language matches the existing console (same modal shell, same field components, same lozenges, same address autocomplete) | Must-have |
| R8 | A no-op submit (operator opened the modal but changed nothing) is silently a no-op — no audit, no mirror write, no SMS (CURRENT already does this for fields) | Nice-to-have |
| 🟡 R9 | Driver-swap is allowed ONLY when booking is in `assigned` state. Not in `in_progress` / `awaiting_*` / terminal. | Must-have (decided) |
| 🟡 R10 | Swap uses the existing signed-link / driver-accept model (no direct-assign / emergency override). The 24h-out scenario has time for the new driver to click. | Must-have (decided) |
| 🟡 R11 | When the new driver accepts, the old driver is dropped from the booking and the exec is re-SMS'd with the new driver + car (the original `assignedSms` is now stale). | Must-have |

---

## Open questions remaining

1. **Re-notify policy on field edits (R3).** Always-notify, ask-each-time, or per-field rules? *(Lower-stakes than driver-swap; can be decided after the swap is shaped.)*
2. **Cancel — fold into edit surface or keep separate?** *(Cosmetic; doesn't change driver-swap design.)*
3. **Old-driver notification on swap.** Auto-SMS old driver "you've been removed from job X", or operator handles it on WhatsApp? *(My instinct: auto-SMS, one-line template, mirrors what we already do on dispatch.)*

---

## A: Relax the dispatch gate — minimal swap **(SELECTED)**

The simplest shape. Driver-swap is just "dispatch, but allowed when state is `assigned` too." No new modal, no new service.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Relax gate** in `generateDispatchLink`: accept `state ∈ {'unassigned', 'assigned'}` instead of `'unassigned'` only (dispatch.ts:62). | |
| **A2** | **Accept-time swap** in `acceptDispatchLink`: when the booking is currently `assigned` and the accepting driverId differs from `assignedDriverId`, treat as swap — same atomic update flips `assignedDriverId`, keeps state at `assigned`, records `before.driverId` in audit. | |
| **A3** | **Notify old driver** — when A2 triggers a swap, send SMS to the previous driver: "Booking JJ-… has been reassigned. You're no longer on it." New SMS template `unassignedSms`. | |
| **A4** | **Re-notify exec** — A2 also re-sends `assignedSms` to the exec with the new driver's name + car (currently sent once on initial accept; resend on swap). | |
| **A5** | **Console reachability** — in `DetailPanel`, when state is `assigned`, show a "Reassign driver" action that opens the existing `DispatchModal`, pre-populated with the *current* driver so the operator picks a *different* one. | |
| 🟡 **A6** | **Audit** — new `driver_swap` action with `before: { driverId: previousId, state: 'assigned' }` and `after: { driverId: newId, state: 'assigned' }`. Sheet mirror re-runs (it already does on `acceptDispatchLink`). | |
| 🟡 **A7** | **State-gated console action (resolves R2 for this scope)** — the "Reassign driver" button in DetailPanel is shown only when `state === 'assigned'`. When state is past `assigned`, no driver-related action appears. R2 (broader "show what's editable everywhere") is consciously scoped out of this round — driver-swap is the only state-gated operation being added. | |

**What's explicitly out of A (deferred, not forgotten):**
- Driver-swap is NOT moved into the edit modal. Edit modal still only handles field edits.
- **R3 (driver re-notify on field edits) is out of scope this round.** Editing pickup time/address/exec mobile after dispatch still won't text the assigned driver. Captured for a future shaping pass — listed in "Deferred" below so it doesn't get lost.

---

## B: Driver lives inside the edit modal

Same outcome for the operator (one mental model: "edit the booking") but the surface is unified.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **B1** | Add `assignedDriverId` to `editBookingSchema` (nullable, only changeable when state is `assigned`). | |
| **B2** | When operator changes driver in the edit modal, `editBooking` service detects it and **delegates to dispatch link-mint flow** (does NOT direct-assign) — returns a link the operator messages to the new driver. Field edits still commit immediately; driver-swap is a separate side-effect of the same submit. | ⚠️ |
| **B3** | Same A3/A4 notifications on the new driver's accept. | |
| **B4** | Same A5 reachability but the action label is "Edit booking" (single entry point); driver section appears inside the edit modal. | |
| **B5** | Dispatch modal becomes the *initial* dispatch only; reassign happens via edit modal. | |

⚠️ B2 is flagged: making one submit produce both an immediate commit (fields) and a deferred external action (driver link) is a worse UX than either alone — the operator clicks "Save", and… what happened? Some changes applied, one is pending the new driver's tap. That ambiguity is the cost of forcing unification.

---

## Fit Check: R × A (selected)

| Req | Requirement | Status | A |
|-----|-------------|--------|:-:|
| R0 | Single editing surface for any field that could be wrong | Core goal | ❌ |
| R1 | Edit-driver reachable from the same surface as edit-fields | Must-have | ❌ |
| 🟡 R2 | State-aware editability is surfaced (narrowed to: reassign-driver button shown only in `assigned`) | Must-have | ✅ |
| R3 | Driver re-notified on changes that affect them | Must-have | ❌ |
| R4 | Every edit writes audit | Must-have | ✅ |
| R5 | Sheet mirror reflects edit | Must-have | ✅ |
| R6 | Edits blocked on terminal states with clear reason | Must-have | ✅ |
| R7 | Visual + interaction language matches existing console | Must-have | ✅ |
| R8 | No-op submit is silent | Nice-to-have | ✅ |
| R9 | Driver-swap only in `assigned` state | Must-have | ✅ |
| R10 | Link-accept model (no direct-assign) | Must-have | ✅ |
| R11 | Old driver dropped + exec re-SMS'd on swap-accept | Must-have | ✅ |

**Notes on the three ❌s:**
- **R0 / R1** fail by deliberate choice — A keeps driver-swap in the dispatch surface, not the edit modal. "Fix a field" and "swap a driver" are different enough cognitively that splitting them is the right call here; we accept the failure rather than pay B2's mixed-submit cost.
- **R3** is explicitly deferred (see "Deferred" below). Not a hidden failure — a scoped-out one.

---

## Deferred (not in this round, captured so they don't get lost)

- **R3 — driver re-notify on field edits.** When an operator edits pickup time / pickup address / exec mobile while a driver is already assigned, the driver isn't told. Worth its own shaping pass; needs per-field rules (price change doesn't need to notify; pickup time does).
- **R0 / R1 — unified editing surface.** Driver-swap stays in dispatch. If operators later ask "why are there two buttons", revisit with B as the starting point.

I'll wait for answers on these before drawing shapes A/B/C — the answers collapse a lot of the option space.
