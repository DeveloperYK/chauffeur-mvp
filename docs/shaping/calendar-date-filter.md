---
shaping: true
---

# Calendar / Date filter for the board — Shaping

## Source

> I'm thinking about scale — one of my concerns is this company takes 60–100
> tickets/bookings a day. How can we present the information in a digestible
> way without cluttering the screen too much. My idea is to introduce a
> calendar system — the dashboard shows the current day but when they click
> the calendar they can see upcoming days exactly like Google Calendar; for
> each day it will show number of tickets and the number assigned and
> unassigned too. When they select an upcoming day the dashboard will show
> for that day. They can even click on previous days too. When using the
> search filter it includes all tickets regardless of date.

---

## Problem

At 60–100 bookings/day the current single-board view will turn into a wall of
cards. Operators need to focus on **today** mostly, but also reach forward to
upcoming days (where most bookings actually live, since they're booked 24h+
ahead) and occasionally look back. Without a date filter, the board is noisy
and operators waste time scrolling.

## Outcome

- An operator opening the dashboard sees only what's relevant for *today*.
- They can move forward and backward in time in one or two clicks.
- They can see at a glance how busy upcoming days are without leaving the board.
- Search is a separate concern — when an operator searches, dates don't filter.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Operators can see and triage a single day's bookings without scrolling past unrelated ones | Core goal |
| R1 | Default view on landing is today's bookings (current device timezone) | Must-have |
| R2 | Operators can navigate to any future or past day in ≤2 clicks | Must-have |
| R3 | Operators see a per-day workload preview (total count + how many unassigned) without leaving the board | Must-have |
| R4 | Search bypasses the date filter — searching surfaces matches from any date | Must-have |
| R5 | Page stays under ~500ms p95 even with 100 bookings per day visible | Must-have |
| R6 | Selected date persists across navigation (e.g. clicking into a booking and back returns to the same day) | Must-have |
| R7 | Date filter must be visually obvious so operators don't think a quiet day means "no bookings ever" | Must-have |
| R8 | Operators can jump back to "today" in one click from any selected date | Nice-to-have |
| R9 | 🟡 A multi-day view (e.g. next 3 days, or a week) for planning longer horizons | Out — defer, calendar overview is enough |

---

## A: Google-Calendar-style day cells with counts (user's sketch)

Compact month-grid calendar that lives next to the board (collapsible sidebar
or popover). Each day cell shows total bookings and unassigned count.
Selecting a day filters the board.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Calendar widget** | |
| A1.1 | Month-grid layout; current day highlighted; selected day distinct | |
| A1.2 | Each cell shows two numbers: `N total · M unassigned`; M coloured if >0 | |
| A1.3 | Prev/next month arrows; "Today" jump-button | |
| **A2** | **Date-filtered board** | |
| A2.1 | Board reads `?date=YYYY-MM-DD` from URL; default today (UTC-anchored) | |
| A2.2 | All 7 columns now contain only bookings whose `pickup_at` date matches selected day | |
| A2.3 | Header shows selected day with explicit pill "Showing: Mon 19 May" | |
| **A3** | **Day-count source** | |
| A3.1 | Server query: `SELECT date(pickup_at), state, count(*) FROM bookings GROUP BY 1, 2 WHERE pickup_at BETWEEN month_start AND month_end` | |
| A3.2 | Cached per request; one round-trip per visible month | |
| **A4** | **Search override** | |
| A4.1 | When a search query is present, board ignores the date filter and shows all matches | |
| A4.2 | Calendar remains visible but greys out; clearing search restores date filter | |
| **A5** | **Timezone & date anchor** | |
| A5.1 | 🟡 "Day" is Europe/London (operators are UK-based, all year incl. BST); `pickup_at` stays UTC in DB; conversion at query boundary | |

## B: Date picker + day view (no calendar overview)

A simple date input control above the board. No month grid; no per-day counts.

| Part | Mechanism | Flag |
|------|-----------|:----:|
| B1 | Single `<input type="date">` above board, defaulting to today | |
| B2 | Board filters to selected date via `?date=YYYY-MM-DD` | |
| B3 | "Today" button + prev/next-day arrows next to picker | |
| B4 | Search bypasses date filter | |
| B5 | No per-day workload preview — operator must navigate to see | |

## C: Time-horizon tabs ("Today / Tomorrow / This week / Custom")

Segmented control of fixed buckets that map to common operator queries. No
calendar grid; no per-day counts on the bucket tabs (just totals).

| Part | Mechanism | Flag |
|------|-----------|:----:|
| C1 | Tabs at the top: Today · Tomorrow · This week · Past · Custom | |
| C2 | Each tab shows its count `(N)` in the label | |
| C3 | "Custom" opens a date picker (degenerates to B for one-off dates) | |
| C4 | Board filters by the tab's date range | |
| C5 | Search bypasses tabs | |
| C6 | No per-day granularity — "This week" is a flat list | ⚠️ |

---

## Fit check

| Req | Requirement | Status | A | B | C |
|-----|-------------|--------|:-:|:-:|:-:|
| R0 | Operators can see and triage a single day's bookings without scrolling past unrelated ones | Core goal | ✅ | ✅ | ✅ |
| R1 | Default view on landing is today's bookings (current device timezone) | Must-have | ✅ | ✅ | ✅ |
| R2 | Operators can navigate to any future or past day in ≤2 clicks | Must-have | ✅ | ✅ | ❌ |
| R3 | Operators see a per-day workload preview (total count + how many unassigned) without leaving the board | Must-have | ✅ | ❌ | ❌ |
| R4 | Search bypasses the date filter — searching surfaces matches from any date | Must-have | ✅ | ✅ | ✅ |
| R5 | Page stays under ~500ms p95 even with 100 bookings per day visible | Must-have | ✅ | ✅ | ✅ |
| R6 | Selected date persists across navigation | Must-have | ✅ | ✅ | ✅ |
| R7 | Date filter must be visually obvious | Must-have | ✅ | ✅ | ✅ |
| R8 | Operators can jump back to "today" in one click | Nice-to-have | ✅ | ✅ | ✅ |
| R9 | 🟡 (Out — deferred) | — | — | — | — |

**Notes:**
- **A fails nothing.** The Google-Calendar overview is the only shape that delivers R3 (per-day workload preview).
- **B fails R3.** Picker-only — operator has to click into each day to see how busy it is.
- **C fails R2.** Custom date is a degenerate 3+ click path; daily granularity isn't first-class.
- 🟡 **A5 resolved** — "day" is Europe/London (covers BST); `pickup_at` remains UTC in DB.

---

## 🟡 Decisions locked in

| # | Decision | Choice |
|---|---|---|
| 1 | Multi-day view (R9) | **Out for now** — calendar overview is the multi-day view |
| 2 | Flagged-ticket surfacing | **Deferred** — we don't yet know what determines a flagged ticket; revisit when that's defined |
| 3 | Layout | **Popover** triggered by a 📅 button in the board toolbar |
| 4 | Date anchor (A5) | **Europe/London** for display; `pickup_at` stays UTC in DB |

## 🟡 Build plan

Shape A goes in as-is with the decisions above. Concrete pieces:

1. `src/lib/dates.ts` — London-day ⇄ UTC-range helpers
2. `src/server/services/bookings-query.ts` — `listBookingsForDay` and `monthlyCounts`
3. `src/components/calendar-popover.tsx` — month grid; cells show `N · M`; prev/next month + Today
4. `src/app/(dashboard)/dashboard/page.tsx` — reads `?date=YYYY-MM-DD&calMonth=YYYY-MM`; defaults to today (London)
5. Tests for date helpers + filtered queries
