---
shaping: true
---

# Booking Revoke — Shaping

> Frame: [`frame.md`](./frame.md). Selected shape: **F** (one-click cancel, no reason, 60 s undo). E superseded 2026-09-05 after the user cut scope.

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | 🟡 An operator can **cancel a booking in one step** (double booking or the client called it off) and **take it back within a minute** if they hit the wrong ticket — without re-keying. | Core goal |
| R1 | 🟡 **No reason, no kind.** Cancelling just marks the booking cancelled. (Client-vs-mistake split dropped — "just say it's been cancelled".) | Decided (Out) |
| R2 | Undo is **safe**: it never resurrects a job under a driver who has since moved on, and never re-sends a confirmation the exec already has. Conflicts are surfaced, not silently overwritten. | Must-have |
| R3 | Cancel and undo each leave an **audit trail** (who, when, from-state → to-state). | Must-have |
| R4 | **The sheet tells the truth.** Cancel removes the row; an undone cancel puts the job back in its row under the same Job #. | Must-have |
| R5 | Cancelled rows are **deleted from the sheet** (current behaviour). A gap in Job #s is acceptable. | Decided |
| R6 | **No exec message** on cancel — the client requests cancellations themselves. Driver link already renders "Booking cancelled". | Out |
| R7 | Undo is available for **~60 seconds** from the toast, then the cancel is final. | Decided |
| R8 | 🟡 Cancel stays limited to **`unassigned` and `assigned`** — cancellations happen before the journey; a finished journey was never a mistake. No later-state cancel, no undo of Approve or Create. | Decided |
| R9 | **Additive, backward-compatible** change: existing states keep working; migration additive only. | Constraint |

🟡 2026-09-05: R1 dropped (no reason, no kind). R8 added — cancel scope stays exactly as CURRENT; late-state cancel and approve/create undo are out. R0 narrowed accordingly.

---

## CURRENT (baseline)

| Aspect | Today |
|---|---|
| Correction tools | **Cancel** only (mandatory reason ≥ 5 chars). Edit exists for live bookings (`booking-edit`). No undo, no reinstate, no void. |
| Cancel allowed from | `unassigned`, `assigned`, `in_progress`. **Not** from `awaiting_driver_form`, `awaiting_operator_review`, `completed`. |
| `cancelled` | Terminal. Records `cancelledAt`, `cancelledByOperatorId`, `cancellationReason`. Audit row `action: 'cancel'`. Open driver offers lapsed. |
| Who is told | **Nobody.** No exec message, no driver message. Driver link renders "Booking cancelled" if reopened. |
| Console surfacing | Cancelled jobs appear in a "Cancelled · N" section of past lists; detail panel shows cancelled-at + reason; price flags suppressed. |
| Sheet on cancel | **Row deleted** by Job # (`deleteRow`). Reconcile re-attempts the delete for cancelled bookings so a lingering row is removed, never resurrected. Slim 18-col layout (A–S) has **no status column**. |
| Sheet on create/edit | `upsertRow` keyed by Job # (col A) — an existing Job # is overwritten in place, a new one appended. So re-inserting a deleted Job # is mechanically possible. |
| Job # | `bookings.seq` identity column, rendered `BKNG-00042`. Never reused. A cancelled job's number disappears from the sheet. |
| Cancel modal copy | Claims the reason is "visible on the sheet" — it isn't (audit finding 7, still open). |

---

## Shapes

### A: Reinstate — make cancel reversible

| Part | Mechanism | Flag |
|------|-----------|:----:|
| A1 | New transition `cancelled → <state before cancel>` (`reinstate` event). Store `stateBeforeCancel` on the booking at cancel time so the machine knows where to return. | |
| A2 | "Reinstate" button on a cancelled booking's detail panel; reason required; audit row `reinstate` with before/after. | |
| A3 | Driver handling on reinstate: if it was `assigned` and the driver's accept is still valid → back to `assigned` and the driver is sent a change-confirm link (reuse mid-flight change flow); otherwise return to `unassigned` and re-dispatch. | ⚠️ |
| A4 | Sheet: reinstate calls `upsertRow` → the row comes back under its original Job #. | |
| A5 | Exec: on cancel of a confirmed job send a cancellation message; on reinstate send the assignment confirmation again only if the driver/time changed. | ⚠️ |

### B: Void — a separate terminal state for operator errors

| Part | Mechanism | Flag |
|------|-----------|:----:|
| B1 | New state `voided` reachable from any non-completed state (and from `completed` within a guard window). Reason required. Audit row `void`. | |
| B2 | Voided bookings are hidden from the board and past lists by default (a "Voided" filter reveals them); they carry no price flags and are excluded from invoicing counts. | |
| B3 | Sheet: void deletes the row (like cancel today). Optionally writes a one-line note to a "Voided" tab: Job #, who, when, why — so the missing Job # is explainable (R5). | |
| B4 | No messages: a voided ticket never existed as far as the exec/driver are concerned — unless a confirmation already went out, in which case the operator is warned and can send the cancellation message from B5. | |
| B5 | Exec cancellation message (new template, email channel) sent on cancel/void of a job that already had a confirmation. | |

### C: Status column on the sheet + reversible cancel + void (A + B, sheet keeps rows)

| Part | Mechanism | Flag |
|------|-----------|:----:|
| C1 | = A1 + A2 + A3 (reinstate). | ⚠️ |
| C2 | = B1 + B2 + B4 + B5 (void). | |
| C3 | Sheet gains a **Status** column (T): `Live` / `Completed` / `Cancelled` / `Voided`. Cancel and void **update the row instead of deleting it**; reinstate flips it back. Job # never disappears (R5) and the reason can genuinely be written to the sheet (fixes audit finding 7). | |
| C4 | Reconcile: state → status mapping replaces the "cancelled ⇒ delete" rule. | |

### D: Time-boxed undo toast (no new states)

| Part | Mechanism | Flag |
|------|-----------|:----:|
| D1 | After Cancel / Approve / Create, the toast offers **Undo** for ~60 s. Undo replays the inverse transition; after the window the action is final. | |
| D2 | Undo of cancel = A1/A4 without the driver re-confirm branch (within 60 s nothing has moved). Undo of approve = `completed → awaiting_operator_review`. Undo of create = hard delete of a booking that never left `unassigned`. | ⚠️ |
| D3 | Sheet: undo re-upserts (cancel) or deletes (create) the row. | |

### E: Cancel *kind* + 60 s undo — superseded by F (kept as audit trail)

No new state. `cancelled` stays the single terminal state; a **kind** on it separates a real cancellation from a mistake, and a time-boxed undo covers slips.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **E1** | **Cancellation kind on `bookings`**: `cancellationKind` enum `client` \| `mistake` (additive column, nullable for legacy rows → treated as `client`). Cancel modal gains a two-way choice ("Client cancelled" / "Entered by mistake — duplicate or wrong ticket"); reason stays mandatory. Audit `after` carries the kind. Modal copy fixed: "Removed from the backup sheet" (closes audit finding 7). | |
| **E2** | **Surfacing by kind**: `mistake` cancellations are hidden from the past-list "Cancelled" section and from any cancellation counts by default, behind a "Show mistakes" toggle; `client` cancellations stay listed as today. Detail panel shows the kind. Invoicing/billable queries already exclude `cancelled`; no change. | |
| **E3** | **Cancel from later states**: allow `cancel` from `awaiting_driver_form` and `awaiting_operator_review` too (a duplicate can be discovered late). Still **not** from `completed`. Sheet delete applies as today. | |
| **E4** | **Undo (toast, 60 s)** — a generic `undoToken` = `{bookingId, action, expectedState, expiresAt}` returned by the cancel / approve / create actions and held in client memory only; the toast shows **Undo** until expiry. Undo calls one server action `undoAction(token)` which re-checks the booking is still in the state the action left it in (else "Too late — booking has moved on"). Audit row `undo_<action>` with before/after. | |
| E4.1 | Undo **cancel** → transition `cancelled → stateBeforeCancel` (new column `stateBeforeCancel`, set at cancel time). Clears `cancelledAt` / reason / kind. Re-upserts the sheet row. Offers that were lapsed by the cancel stay lapsed (the operator re-dispatches if needed) — within 60 s no driver has been told anything, so R2 holds. | |
| E4.2 | Undo **approve** → `completed → awaiting_operator_review`. Completion data untouched. Sheet row re-upserted (completion columns P–R stay, nothing to remove). | |
| E4.3 | Undo **create** → cancel with kind `mistake` and reason "Undone by operator" via E1 (no hard delete; audit intact; sheet row deleted). Only offered while the booking is still `unassigned` with no offers sent. | |
| **E5** | **State machine**: two new events `undo_cancel` (`cancelled → stateBeforeCancel`) and `undo_approve` (`completed → awaiting_operator_review`), plus the E3 cancel edges. `isTerminal()` unchanged. Lifecycle E2E extended for each new edge. | |

**Dropped from the earlier shapes and why:** A's hours-later reinstate (R7 says 60 s is enough; the driver-reconfirm branch A3 was the only flagged unknown), B's separate `voided` state (a kind on `cancelled` gives the same distinction with one fewer state, R8), B5/C3 exec message and sheet Status column (R6 out, R5 decided).

### F: One-click cancel + 60 s undo — **SELECTED** (= D, cancel only)

Cancel scope, states and sheet behaviour are exactly CURRENT. Two changes: the reason goes, and the cancel becomes undoable for a minute.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **F1** | **Reason optional → removed from the UI.** `cancelBookingSchema.reason` becomes optional (schema accepts absent; existing rows keep theirs). Cancel modal becomes a plain confirm: title "Cancel this booking?", one line naming passenger + time + Job #, buttons **Keep booking** / **Cancel booking**. Copy: "The booking is removed from the backup sheet. You can undo for 60 seconds." (closes audit finding 7). | |
| **F2** | **Remember where it came from**: additive column `bookings.state_before_cancel` (enum, nullable), set by `cancelBooking` alongside `cancelledAt`. | |
| **F3** | **Undo cancel** — server action `undoCancelAction(bookingId)`: loads the booking, requires `state = 'cancelled'` **and** `cancelledAt` within the last 60 s (server clock; the toast timer is cosmetic), transitions `cancelled → state_before_cancel` via new machine event `undo_cancel`, clears `cancelledAt` / `cancelledByOperatorId` / `cancellationReason` / `state_before_cancel`, audit row `undo_cancel` with before/after, re-upserts the sheet row (`mirrorBooking`). Outside the window → `{ok:false, reason:'too_late'}` → toast "Too late — cancellation is final." | |
| F3.1 | Offers lapsed by the cancel **stay lapsed**: if it was `assigned`, the accepted driver is still on `assignedDriverId` so it returns to `assigned` intact; if it was `unassigned` with open offers, the operator re-dispatches. Within 60 s no driver or exec has been messaged, so R2 holds. | |
| **F4** | **Undo toast**: the cancel toast gains an **Undo** button for 60 s (countdown or plain expiry). Clicking calls F3; success re-renders the board with the booking back in place and a "Cancellation undone." toast. | |
| **F5** | **State machine + E2E**: add `undo_cancel` edges `cancelled → unassigned` / `cancelled → assigned` (guarded by `state_before_cancel`). `isTerminal('cancelled')` stays true for every other purpose. Lifecycle E2E: cancel → undo → assert back in prior state and back on the sheet mirror; cancel → wait past window (TestClock) → undo refused. | |

---

## Fit Check

| Req | Requirement | Status | E | F |
|-----|-------------|--------|---|---|
| R0 | One-step cancel; take it back within a minute without re-keying | Core goal | ✅ | ✅ |
| R1 | No reason, no kind | Decided (Out) | ❌ | ✅ |
| R2 | Undo is safe: no moved-on driver, no duplicate exec confirmation | Must-have | ✅ | ✅ |
| R3 | Audit trail for cancel and undo | Must-have | ✅ | ✅ |
| R4 | Sheet tells the truth; undone cancel back in its row | Must-have | ✅ | ✅ |
| R5 | Cancelled rows deleted from the sheet | Decided | ✅ | ✅ |
| R6 | No exec message on cancel | Out | ✅ | ✅ |
| R7 | Undo for ~60 s, then final | Decided | ✅ | ✅ |
| R8 | Cancel limited to unassigned / assigned; no late cancel, no approve/create undo | Decided | ❌ | ✅ |
| R9 | Additive, backward-compatible | Constraint | ✅ | ✅ |

**Notes:**
- E fails R1 (it adds a kind + keeps the reason) and R8 (E3 late-state cancel, E4.2/E4.3 approve/create undo) — all scope the user cut.
- F is CURRENT minus the reason plus one reversible edge. One additive column, one new machine event, one server action, one toast button.
- Earlier shapes A–D are kept above as the audit trail; they are not re-scored here.

---

## Open questions — resolved

| # | Question | Answer (2026-09-05) |
|---|----------|--------|
| Q1 | Which mistake actually happens? | Double bookings, and clients cancelling. |
| Q2 | Sheet: status column or delete rows? | Delete rows (keep current behaviour). |
| Q3 | Tell the exec on cancel? | No — they request it themselves. |
| Q4 | Is a 60 s undo enough? | Yes. |
| Q5 | Mandatory reason? | No — "just say it's been cancelled". |
| Q6 | Cancel from later states / undo Approve? | No — cancellations happen before the journey; keep unassigned + assigned only. |

## Open questions by part

| Part | Question |
|------|----------|
| F1 | Keep the reason as an *optional* free-text line in the confirm (harmless, occasionally useful), or remove the box entirely? Doc assumes removed. |

## Next step

Built as one slice — see [`slices.md`](./slices.md) and ADR `docs/adr/0011-cancel-undo-window.md`. Q on F1 resolved: reason box removed entirely.
