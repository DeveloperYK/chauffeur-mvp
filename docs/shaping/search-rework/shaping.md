---
shaping: true
---

# Operator Search Rework — Shaping

See [frame.md](./frame.md) for problem & outcome.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | From anywhere in the console, find any booking by **reference, driver, or exec** — regardless of date or the current board view | Core goal |
| R1 | 🟡 **Find by booking ID — the primary use case.** Match the booking number flexibly: bare number (`42`), padded (`00042`), and full ref (`BKNG-00042`, case-insensitive) all resolve to booking #42 | 🟡 Core goal |
| R2 | Match **driver name** (the assigned driver) | Must-have |
| R3 | Match **exec / passenger name** (first + last) | Must-have |
| R4 | Results update **live as you type** (debounced ~200ms) | Must-have |
| R5 | Search is **global** — spans all days and states, not limited to the loaded board | Must-have |
| R6 | **Filter by driver** — scope results to one driver's jobs | Must-have |
| R7 | **Performant at scale** — p95 < 200ms on the full table; indexed; results bounded/paginated | Must-have |
| R8 | Selecting a result **opens the booking** (detail) directly | Must-have |
| R9 | Reachable **without losing the current board context** (don't navigate away / lose your place) | 🟡 Must-have |
| R10 | Retain today's matchable fields (pickup/dropoff address, account code, case code, vehicle) | 🟡 Nice-to-have |

**Parked (out of scope for now):**
- Exec phone (`execMobile`) and client/company (`clientName`) matching — not selected; trivial to add to the engine later.
- State / date-range / service-type / account filters as new controls — existing day picker + state saved-views remain; revisit if needed.

---

## CURRENT: how search works today

| Aspect | Today |
|--------|-------|
| Where | Topbar free-text box, `?q=`; drivers tab has its own name-only box |
| Engine | **100% client-side** `.includes()` over the bookings already loaded |
| Scope | Only the **current day** (or one state via a saved view) — off-screen bookings are unfindable |
| Matches | UUID, passenger name, pickup/dropoff address, account code, case code, vehicle |
| Misses | **Booking ref (`BKNG-…`)**, **driver name**, exec phone, client/company |
| Query layer | `bookings-query.ts` fetches by day/state with `LIMIT`; no search `WHERE` |
| Indexes | `state`, `pickup_at`, `(state,pickup_at)`, `assigned_driver_id`, `assigned_operator_id` — **none on text fields** |

---

## Shared engine (all shapes include this)

The three shapes differ only in the **surface**. They all sit on the same server-side search. **Spike resolved** ([spike-search-engine.md](./spike-search-engine.md)) — flags cleared:

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **S1** | 🟡 **`searchBookings(db, q, { driverId, limit })`** in `bookings-query.ts` (195 LoC, room). Normalise `q` → if it reduces to digits (`/\D*(\d+)/`, strips `BKNG-`/zeros) treat as **exact `seq` hit** (ranked first); else `OR`-group of `ilike('%q%')` over passenger name, driver name, pickup/dropoff address, account code, case code (R10). `leftJoin(drivers)` for name match; returns the existing **`ConsoleBooking`** shape via `toConsoleBooking`. Bounded by `LIMIT` + ordered by `pickupAt`. | |
| **S2** | 🟡 **No index/extension** — plain `ILIKE` only (PGlite can't load `pg_trgm`/`tsvector`; this is the Supabase∩PGlite subset). Exact `seq` match uses the integer column. Performant at current scale; **future:** add a `pg_trgm` GIN index (prod-only, guarded) if volume exceeds ~100k rows. | |
| **S3** | 🟡 **Transport** (component, see below) — how the live debounced query reaches `searchBookings`. | |

### S3: live-query transport

| Req | Requirement | Status | S3-A (Server Action + debounce) | S3-B (Route Handler + AbortController) |
|-----|-------------|--------|:---:|:---:|
| R4 | Live as-you-type (debounced) | Must-have | ✅ | ✅ |
| R7 | Performant; no stale results shown | Must-have | ✅ (latest-wins guard) | ✅ (cancels in-flight) |

**Notes:**
- S3-A: client debounce (mirror the `useRef`+`setTimeout` pattern already in `address-autocomplete.tsx`) → call a `searchBookingsAction` server action; guard against out-of-order responses by tracking the latest query. No new infra; matches the app's existing action pattern.
- S3-B: new `GET /api/search` route handler; client uses `AbortController` to cancel superseded keystrokes. More polished cancellation, but new public-ish route to rate-limit/guard.
- **Lean S3-A for the first slice** (simplest, no new route to secure); upgrade to S3-B only if typing latency/cancellation proves insufficient.

---

## A: Command palette (⌘K / "/" global overlay)

A keyboard-summoned overlay (Spotlight / Linear-style) that floats over the board.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | Includes **S1 + S2** (shared engine) | ⚠️ |
| **A2** | Overlay summoned by `⌘K` / `/`; debounced input; ranked result list (`BKNG-… · date · exec · driver · state`); arrow-key nav | |
| **A3** | **Driver filter** as an in-palette chip/toggle (R6) | |
| **A4** | Select (click / ↵) → open booking detail panel or `/dashboard/bookings/[id]` | |

---

## B: Inline board → global results list

Keep the topbar box; when a query is present, the board region swaps to a flat, cross-date results list. Clearing the query returns to the day board.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **B1** | Includes **S1 + S2** (shared engine) | ⚠️ |
| **B2** | Topbar box drives `?q=`; when `q` present, board area renders a **flat cross-date results list** (server-driven, paginated) instead of the day columns | |
| **B3** | **Driver filter** dropdown beside the results (R6) | |
| **B4** | Row click → open booking detail panel (same as board) | |

---

## C: Dedicated /dashboard/search page

A full results page with input, driver filter, and room for more filters later.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **C1** | Includes **S1 + S2** (shared engine) | ⚠️ |
| **C2** | New `/dashboard/search` route; topbar box routes here with `?q=`; full results **table** | |
| **C3** | **Driver filter** + space for future filters (state, date range, account) | |
| **C4** | Row click → `/dashboard/bookings/[id]` | |

---

## Selected shape: **A — Command palette** 🟡

Decided: A satisfies R9 (Must-have) — keyboard-instant, board stays visible behind the overlay. Engine unknown resolved in [spike-search-engine.md](./spike-search-engine.md); breadboard + slices in [slices.md](./slices.md).

## Fit Check — R × A (selected)

| Req | Requirement | Status | A |
|-----|-------------|--------|---|
| R0 | Find any booking by ref/driver/exec from anywhere, any date | Core goal | ✅ |
| R1 | Find by booking ID (flexible: `42` / `00042` / `BKNG-00042`) — **primary use case** | Core goal | 🟡 ✅ |
| R2 | Match driver name | Must-have | 🟡 ✅ |
| R3 | Match exec/passenger name | Must-have | 🟡 ✅ |
| R4 | Live as-you-type (debounced) | Must-have | ✅ |
| R5 | Global across days/states | Must-have | ✅ |
| R6 | Filter by driver | Must-have | ✅ |
| R7 | Performant at scale | Must-have | 🟡 ✅ |
| R8 | Selecting a result opens the booking | Must-have | ✅ |
| R9 | Reachable without losing board context | Must-have | ✅ |
| R10 | Retain today's matchable fields | Nice-to-have | 🟡 ✅ |

**Notes:**
- 🟡 **Spike resolved** R1–R3, R7, R10: plain `ILIKE` + exact `seq` match over a `leftJoin(drivers)`, bounded by `LIMIT`. No extension/index needed (PGlite-compatible). All engine rows now ✅ — no open flags on the selected shape.
- R4/R5/R8/R9 are surface concerns already settled by choosing A. R4/R7 transport detail = S3 (lean S3-A server action).

### Why not B / C (audit trail)

| Req | A | B | C |
|-----|---|---|---|
| R9 Reachable without losing board context | ✅ | ❌ | ❌ |

B replaces the board region while searching; C navigates to a separate page. Both fail R9 (now Must-have), so A is selected. C remains the fallback if we later want a heavy multi-filter results view.
