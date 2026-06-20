---
shaping: true
---

# Mid-Flight Booking Changes + Operator-Attested Assignment — Shaping

> **Scope note:** this doc covers two capabilities unified by one principle — *the operator can act on a driver's behalf after a phone call*. (1) Confirming a mid-flight **change**, and (2) **assigning/swapping** a driver by attestation instead of waiting for a link tap. Both sit alongside the existing signed-link flow, never replacing it.

## Source

> A feature I want to discuss with you is what if a booking changes midflight or just before the in progress state. How does the operator handle a scenario where the exec needs to go somewhere else now or has changed their destination etc. How is the driver informed[?] one thing to flag is it might be limiting or frustrating if the operator has to contact the driver via the link if the booking changes midflight or just before starting. There should be a system in place that considers if the operator just calls the driver to confirm the new location/booking then they can say yes on behalf of the driver via the platform. I'm thinking we need to make the platform more flexible to handle these nuanced cases.

---

## Problem

A booking is dispatched and a driver has accepted (`assigned`), or the trip is already running (`in_progress`). Then the plan changes: the exec wants a different destination, an added stop, a new pickup, "take me somewhere else now."

The operator can already **edit the data** — `editBooking` permits changing destination, pickup, time, duration and price in every state except `completed`/`cancelled`. What's missing is everything that makes the change *real*:

1. **The driver isn't told.** `editBooking` has no notification side effect. The driver was SMS'd the original details on accept; a later change is invisible to them unless they happen to reopen their link. (This is exactly the **R3 deferred** from the booking-edit shaping.)
2. **There's no record the driver knows or agrees.** Nothing distinguishes "operator changed the DB" from "driver has confirmed the new plan." The console shows the new details as if they were always true.
3. **The only confirmation tool we have is the signed link** — and forcing the driver through a tap-to-confirm link is slow and frustrating mid-trip. In reality the operator often just phones the driver. The platform should let the operator **record that confirmation on the driver's behalf**, not pretend the phone call didn't happen.

## Outcome

When a booking materially changes after dispatch, the operator can make the driver aware of the new plan and capture the driver's agreement — including **confirming on the driver's behalf after a phone call** — so the system reflects reality (driver knows and agreed) with a clear audit trail, **without a mandatory signed-link round-trip**. The platform is flexible about *how* confirmation happens, not rigid.

---

## CURRENT

| Surface | What it does today | Gap for this feature |
|---|---|---|
| `editBooking` service (`edit-booking.ts`) | Validates + diffs fields, writes DB, mirrors sheet, records `edit` audit row with `changedFields`. Allowed in any non-terminal state. | **No notification dep.** Driver and exec are never told about the change. |
| Driver link page (`/j/[token]`) | Renders **live DB state** (token holds only ids/exp/jti). A driver who reopens the link sees new details. | Nothing is **pushed**; no acknowledgement is **captured**. |
| Dispatch / accept (`dispatch.ts`) | Signed-link accept/decline model; on accept exec gets `assignedSms`. Driver-swap (booking-edit V1) reuses this in `assigned`. | The link round-trip is the friction we want to avoid for *changes to an already-confirmed job*. |
| Exec SMS | `assignedSms` (on accept), `enRouteSms` (clock T‑1h). | Not re-sent when the booking the exec was told about changes. |
| Audit (`audit_events`) | Append-only, `before`/`after` JSONB, indexed by entity. | Ready to record a "change confirmed" event — needs an actor/method for on-behalf attestation. |

**Key insight:** the data-mutation half is done. This feature is about the **confirmation + notification half** that `editBooking` deliberately left out, plus a new idea the link model doesn't support: **operator-attested confirmation**.

---

## Decisions (forks resolved 2026-06-20)

1. **Confirmation semantics → acknowledgement only.** Confirming records "driver is aware and will do it." No in-app accept/decline. A driver who won't do it is handled by phone (and reassigned via the existing driver-swap if pre-start). This matches the "say yes on their behalf" framing.
2. **Blocking → advisory, non-blocking.** The edited details are live immediately. The booking carries a "driver not yet confirmed" badge until cleared. The DB never disagrees with reality about *what the plan is* — only about *whether the driver has confirmed it*.
3. **Notify trigger → operator chooses per change.** After a material edit the operator picks: text the driver a confirm link / "I'll call & attest" / no notify.
4. **Price/pay → auto-recompute deferred, manual edit in scope.** This round does not auto-recalculate cost/driver-pay (see Deferred), but the operator can manually change the contract price as part of handling a changed booking (R8).
5. **Manual assign by attestation (added 2026-06-20).** Operator can assign a driver directly by attesting they agreed by phone (`unassigned → assigned`), as an alternative to send-link-and-wait. **No SMS to the newly-assigned driver** — the phone call was the confirmation.
6. **Swap too (added 2026-06-20).** Operator-attest also covers driver swaps in `assigned`, **fully reversing booking-edit R10** (which had mandated link-only for swaps). Send-link-and-wait stays available for both assign and swap.

These collapse to **Shape A**. They reject **B** (link round-trip is the exact friction the source wants gone) and **C** (a new state-machine state is overkill — acknowledgement is advisory and orthogonal to the booking's lifecycle state).

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | When a booking changes after dispatch (`assigned` / `in_progress`), the operator can make the driver aware of the new plan **and** capture the driver's agreement — without a mandatory signed-link round-trip | Core goal |
| **R1** | **Confirmation channel (the central idea)** | |
| R1.1 | Operator can confirm a change **on the driver's behalf** (e.g. after a phone call), recorded as operator-attested with who/when | Must-have |
| 🟡 R1.2 | Driver can also self-confirm via a pushed single-tap link (acknowledgement, not accept/decline) — for when a call isn't practical | Must-have |
| R1.3 | The confirmation record distinguishes *how* it was confirmed (driver-self vs operator-attested) | Must-have |
| **R2** | **Change visibility** | |
| R2.1 | The system distinguishes "changed but driver not yet confirmed" from "driver confirmed", visible at a glance in the console | Must-have |
| R2.2 | Only **material** changes (destination, pickup, time, duration — things the driver was told) flag for re-confirmation; cosmetic/operator-only changes (operator notes, account code) don't | Must-have |
| **R3** | **Lifecycle fit** | |
| R3.1 | Works mid-trip (`in_progress`), where an SMS link is impractical and operator-attest is the primary path | Must-have |
| R3.2 | Works just-before-start (`assigned`), where either channel is reasonable | Must-have |
| 🟡 R4 | The change notification to the driver is handled by the system (operator picks the channel; the system does the sending/linking) — not remembered manually. Resolves the deferred booking-edit R3 | Must-have |
| R5 | Every change + confirmation writes an audit row: actor, before/after, confirmation method | Must-have |
| 🟡 R6 | Exec is (re-)notified when a change affects what they were told (e.g. destination/time) | Nice-to-have |
| **R7** | 🟡 **Operator-attested assignment** | |
| 🟡 R7.1 | Operator can assign a driver at the initial assigning stage by attesting they agreed by phone (direct `unassigned → assigned`), without waiting for a link tap | Must-have |
| 🟡 R7.2 | Operator can likewise swap/reassign a driver by attestation in `assigned` (not only via link) — reverses booking-edit R10 | Must-have |
| 🟡 R7.3 | "Send link & wait" stays available as the alternative path for both assign and swap | Must-have |
| 🟡 R7.4 | A directly-assigned/swapped booking is downstream-identical to a link-accepted one (same exec SMS + completion flow), except the recorded assignment method; **no SMS to the newly-assigned driver** | Must-have |
| 🟡 R7.5 | Outstanding dispatch offers to other drivers lapse when a driver is directly assigned | Must-have |
| 🟡 R8 | Operator can change the contract price as part of handling a changed booking; a price-only change is exec/client-facing and does **not** trigger driver re-confirmation | Must-have |

> Chunked to keep the top level scannable. R1/R2/R3/R7 are groups; the rest are flat. Auto price/pay **recompute** is in **Deferred**; manual price edit is R8.

---

## A: Change-confirmation layer on the booking **(SELECTED)**

A thin acknowledgement layer riding on top of the existing `editBooking`. No new state-machine state — `changeStatus` is an attribute orthogonal to the booking's lifecycle state.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Material-change classifier** (domain, pure). `isMaterialChange(changedFields)` → true if any driver-facing field changed: `pickupAt`, `pickupAddress`, `dropoffAddress`, `expectedDurationMinutes`, `serviceType`, `distanceMeters`, `notes` (driver-facing). Cosmetic fields (`operatorNotes`, `accountCode`, `caseCode`, `contractPricePence`, exec name) are NOT material. Unit-tested. | |
| **A2** | **Confirmation columns on `bookings`** (migration): `changeStatus` `'none'\|'pending'\|'confirmed'` (default `'none'`), `changePendingSince` timestamptz null, `changeConfirmedAt` timestamptz null, `changeConfirmedMethod` `'driver_self'\|'operator_attested'\|null`, `changeConfirmedByOperatorId` uuid null. | |
| **A3** | **Edit hook sets pending.** In `editBooking`: when `state ∈ {assigned, in_progress}` AND `isMaterialChange(changedFields)`, set `changeStatus='pending'`, `changePendingSince=now`, null the `changeConfirmed*` fields (a new change supersedes any prior confirmation). Return a `materialChange: boolean` so the UI knows to prompt the notify choice. | |
| **A4** | **Operator-chosen notify.** After a material edit the console offers: **(a) Text driver** → send `changeSms(booking, url)` with a single-tap confirm link; **(b) I'll call & attest** → opens A5; **(c) No notify** → leave `pending`. New SMS template `changeSms`. | |
| **A5** | **Operator-attest action.** `confirmChangeOnBehalf(bookingId, operatorId)` service → `changeStatus='confirmed'`, `changeConfirmedMethod='operator_attested'`, records actor+time, audit `change_confirmed`. Console button "Driver confirmed by phone". Works in both `assigned` and `in_progress`, and for backfill/subcontractor drivers (who have no app link). | |
| **A6** | **Driver self-confirm.** New link type `change_confirm` on the `/j/[token]` page: driver opens it, sees current details, taps "Confirm" → `confirmChangeBySelf(token)` → `changeStatus='confirmed'`, `changeConfirmedMethod='driver_self'`, audit `change_confirmed`. Token expiry = `dispatchLinkExpiry(pickupAt)` (pickup + 2d); one-shot via `jti`. | |
| **A7** | **Console visibility.** DetailPanel + board badge: when `changeStatus='pending'` show "⚠ Change — driver not confirmed" with the two clear actions (Text driver / Confirmed by phone); when `confirmed` show "Confirmed by {phone/driver} at {time}". Badge only renders in `assigned`/`in_progress`. | |
| **A8** | **Audit + mirror.** New `change_confirmed` audit action (`after: { method, actorType }`). `editBooking` already mirrors the sheet on edit; add `changeStatus` to the mirrored row so the sheet shows confirmation state. | |
| **A9** | **Exec re-notify (R6, nice-to-have).** Add "also notify exec" to the A4 choice when the changed field is exec-facing (destination/pickup/time): re-send a short exec SMS. Can ship after A1–A8. | ⚠️ |
| **A10** | **Direct assign / swap service** `assignDriverDirect(bookingId, driverId, operatorId, deps)`. From `unassigned`: atomic → `assigned`, set `assignedDriverId`, `assignedAt`, `assignmentMethod='operator_attested'`. From `assigned` with a *different* driver (swap): flip driver, keep `assigned`, SMS old driver `unassignedSms` (reuse booking-edit), re-send exec `assignedSms`. Both paths: lapse open offers, **send nothing to the newly-assigned driver**, mirror, audit. Reuses the `acceptDispatchLink` transition logic minus the token. | |
| **A11** | **`assignmentMethod` column** on `bookings`: `'driver_self' \| 'operator_attested' \| null`. `acceptDispatchLink` sets `'driver_self'`; A10 sets `'operator_attested'`. | |
| **A12** | **Console assign/swap UI.** In the dispatch picker (`unassigned`) and the reassign picker (`assigned`), add a "Mark confirmed (called them)" action next to "Send link". On an assigned booking, show the method ("Confirmed by phone" vs "Accepted link"). | |
| **A13** | **Audit** new actions `operator_assign` / `operator_swap` with `after: { driverId, method }` (plus `before.driverId` for swap). | |
| **A14** | **Price on change.** `contractPricePence` is already editable via `editBooking`; ensure the change/edit surface exposes it. Per A1, price is non-material, so a price-only edit does **not** set `changeStatus='pending'`. | |

**What's explicitly out of A:** no accept/decline (acknowledgement only), no new booking state, no auto price/pay **recompute** (Deferred — but manual price edit is in, A14), no auto-SMS on change (operator always chooses), no SMS to a directly-assigned driver.

---

## B: Reuse the dispatch link/accept model for changes *(rejected)*

Treat a material change as a re-dispatch: mint a "details changed — confirm" link, driver taps accept; operator-attest is a manual override. **Rejected** — the mandatory link round-trip is the exact friction the source calls out, and accept/decline semantics were declined.

## C: New `awaiting_change_confirmation` booking state *(rejected)*

Add an explicit state in the machine. **Rejected** — confirmation is advisory/non-blocking, so it must NOT gate the lifecycle. An orthogonal `changeStatus` attribute (A2) models it without touching the state machine, clock transitions, or the lifecycle E2E's state assertions.

---

## Fit Check: R × A

| Req | Requirement | Status | A |
|-----|-------------|--------|:-:|
| R0 | Awareness + agreement after dispatch, no mandatory link round-trip | Core goal | ✅ |
| R1.1 | Operator confirms on driver's behalf, recorded with who/when | Must-have | ✅ |
| R1.2 | Driver self-confirms via single-tap link | Must-have | ✅ |
| R1.3 | Confirmation record distinguishes the method | Must-have | ✅ |
| R2.1 | Pending vs confirmed visible at a glance in the console | Must-have | ✅ |
| R2.2 | Only material changes flag; cosmetic/operator-only don't | Must-have | ✅ |
| R3.1 | Works mid-trip (`in_progress`), attest is primary | Must-have | ✅ |
| R3.2 | Works just-before-start (`assigned`), either channel | Must-have | ✅ |
| R4 | System handles notification (operator picks channel), not manual memory | Must-have | ✅ |
| R5 | Change + confirmation write audit rows | Must-have | ✅ |
| R6 | Exec re-notified on exec-facing changes | Nice-to-have | ✅ |
| 🟡 R7.1 | Direct assign by attestation (`unassigned → assigned`), no link tap | Must-have | ✅ |
| 🟡 R7.2 | Swap by attestation in `assigned` (reverses booking-edit R10) | Must-have | ✅ |
| 🟡 R7.3 | "Send link & wait" stays available for assign and swap | Must-have | ✅ |
| 🟡 R7.4 | Directly-assigned booking downstream-identical; no SMS to that driver | Must-have | ✅ |
| 🟡 R7.5 | Open offers lapse on direct assign | Must-have | ✅ |
| 🟡 R8 | Operator can change the contract price on a changed booking | Must-have | ✅ |

**Notes:**
- R6 is satisfied by A9, which is flagged (⚠️) as the one part that can ship after the core. It's a nice-to-have, so a later landing doesn't block the shape.
- R7.1–R7.5 are mechanised by A10–A13. The existing `acceptDispatchLink` flow is unchanged (it gains only the `assignmentMethod='driver_self'` write); A10 is a token-less sibling that reuses its transition + side-effect logic.
- R8 is satisfied by A14 — `contractPricePence` is already editable; the work is surfacing it in the change flow and keeping it out of the material-change classifier.
- No ❌. Every must-have is mechanised by a concrete, unflagged part.

---

## Deferred (captured so they don't get lost)

- **Auto price / driver-pay recompute on change.** A change that adds distance/duration changes the cost and the driver's pay. This round lets the operator *manually* change the contract price (R8 / A14); automatic recomputation + driver-pay handling is its own shaping pass (couples to pricing/backfill-pay logic).
- **A9 exec re-notify** can be split out if V1 needs to be smaller.

---

## Next step

Shape A is selected and breadboard-ready. Next: run `/breadboarding` to turn A1–A14 into affordance tables + wiring, then slice. Likely shape of the slices:
- **V1 — Change confirmation** (A1–A8): material-change flag, operator-attest + driver self-confirm, console badge, audit, mirror.
- **V2 — Operator-attested assign/swap** (A10–A13) + **price-on-change** (A14). Independent of V1; could ship first if preferred.
- **V3 (optional) — exec re-notify** (A9).
