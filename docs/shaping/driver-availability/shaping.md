---
shaping: true
---

# Driver Availability — Shaping

## Source

> The next thing I wanna work on is the driver availability system. I don't like the current approach where it's how many bookings in a week, and it's out of 15. Let's do something better, more useful for the operator.

---

## Problem (initial framing — to refine with user)

The current "availability" model is **workload-as-a-fraction**: each driver is shown as `X / 15 wk` with a bandwidth bar that goes amber > 50%, red > 80%. The 15 is a hardcoded constant. The number conflates two things that aren't the same question:

1. **Workload / fairness** — has this driver done their share this week?
2. **Can they actually take this booking right now?** — are they free at the pickup time, and are they positioned to do it?

A bar saying "12 / 15 wk" doesn't help an operator decide "I have a 6pm Heathrow pickup, who should take it?" The signal is in the wrong shape: it answers a manager's quarterly fairness question, not an operator's in-the-moment dispatch question.

There's also no concept of **planned unavailability** (driver on holiday, day off, sick) — the only switch is `drivers.active` (on/off entirely).

## Outcome (initial framing — to refine with user)

When picking a driver to dispatch, the operator can see at a glance — for each candidate driver — the information they actually use to make the call. The "X / 15" bar goes away. Fairness, if it matters, is expressed differently and is secondary to "can they do this job."

---

## CURRENT

Availability surfaces today, exhaustively:

| Place | What it shows | Source |
|---|---|---|
| **Dispatch modal** (driver row list) | `BUSY` / `FREE` lozenge (any overlap with this booking's window); bandwidth bar `<N> / 15 wk`; sort priority is tier → not-busy → fewer jobs this week. | `dispatch-modal.tsx` + `weekLoads` from `bookings-query.ts:listDriverDispatchData` |
| **Drivers page** (roster list) | Same `<N> / 15` bar per driver; a small `N ACTIVE` lozenge if they currently hold any active jobs. | `drivers/page.tsx` + same `weekLoads` |

The data backing both:

- `weekLoads[driverId]` = count of active bookings (state in `ACTIVE_STATES`) for that driver whose pickup falls in the **current calendar week** (Mon 00:00 → next Mon 00:00, server local time).
- `windows[]` = `[{driverId, startMs, endMs}]` for every active assignment, using `pickupAt` and `expectedDurationMinutes || 60`. The dispatch modal uses this in-memory to compute `BUSY` as "any window overlaps the candidate booking's window."

What is **not** modelled today:
- **Planned time off** — no holiday/sick/day-off concept. `drivers.active = false` is a hard global off-switch.
- **Working pattern** — no per-driver "I work Tue/Thu/Sat" or shift hours.
- **Buffer / travel time** between back-to-back jobs — `BUSY` is purely overlap, with no padding.
- **Location** — no idea where a driver finishes one job vs where the next one starts.
- **Future bookings beyond this week** — "this week" cuts off at next Monday, so a driver with 4 jobs Mon-Tue and nothing else for the month still shows the same `4/15` bar.

The `15` is a hardcoded `WEEK_TARGET` constant in `dispatch-modal.tsx` and a magic `15` in `drivers/page.tsx`.

---

## Requirements (R)

🟡 Direction confirmed by user: **timeline-aware dispatch view + a way to mark a driver off** (option 4).

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | Operator picking a driver for a specific pickup can see, per candidate, the driver's other jobs around that window — gaps and conflicts are visible at a glance, not inferred from a `BUSY` lozenge | Core goal |
| R1 | The `X / 15 wk` bandwidth bar is removed from the dispatch modal — its job is taken over by the timeline | Must-have |
| R2 | Operator can mark a driver as **off** for a specific date or date range (e.g. "Tom is off Thu-Sun for a wedding") | Must-have |
| R3 | A driver who is marked off for the pickup date is excluded from the dispatch modal's candidate list (hard exclusion, with a clear reason shown) | Must-have |
| R4 | Marking-off is reversible by any operator and is auditable (who set it, when, optional reason) | Must-have |
| R5 | The drivers page reflects who is off today and in the coming N days, so operators know without opening the dispatch modal | Must-have |
| R6 | Timeline shows enough context around the pickup window to spot bad back-to-backs (e.g. ±6h on the same day), but not so much it becomes noise | Must-have |
| R7 | "Off" is a planned, time-bounded state — distinct from the existing `drivers.active = false` (which is a global, indefinite kill-switch e.g. "no longer works for us") | Must-have |
| R8 | What replaces the `X / 15` workload bar on the **drivers page** is a separate, secondary decision — can ship later or never | Nice-to-have |

---

## Decisions locked (was: Open questions)

🟡 All three of the originally-open shaping questions were resolved by the user:

1. ✅ **Granularity** — whole-day date ranges only. No half-days. No time-of-day precision.
2. ✅ **Recurring patterns** — none. Ad-hoc one-off time-off only; no per-driver weekly mask. Drivers are nominally available every day until marked off.
3. ✅ **Reason field** — no reason. Just dates.

---

## A: Timeline strip + simple `driver_time_off` table **(SELECTED)**

| Part | Mechanism | Flag |
|------|-----------|:----:|
| 🟡 **A1** | **New table `driver_time_off`** (`id`, `driver_id` FK, `starts_on` date, `ends_on` date inclusive, `created_by_operator_id`, `created_at`). No reason column (decision #3). Index on `(driver_id, starts_on, ends_on)`. | |
| 🟡 **A2** | **Service `setDriverTimeOff` / `clearDriverTimeOff`** + helper `isDriverOffOn(driverId, date)`. Takes `driverId`, `startsOn`, `endsOn` (no reason param). Audit row on every change. | |
| **A3** | **`listDriverDispatchData` extension.** In addition to `windows`, return `timeOff: Record<driverId, Array<{startsOn, endsOn}>>` so the dispatch modal can filter and explain. Drop `weekLoads` from the response — no longer used. | |
| **A4** | **Dispatch modal: remove `WEEK_TARGET` / bandwidth bar / `jobsThisWeek` from sort key.** Replace driver row's right-hand "BUSY/FREE + bar" with a **mini timeline strip** spanning ±6h around the candidate booking's pickup, with the candidate window highlighted and existing assignments shown as filled blocks. | |
| 🟡 **A5** | **Hard-exclude drivers on time-off for the pickup date** from the modal's candidate list. Show them collapsed under "Off on <date>: Tom, Andy" (no reason to display). Operator can see who's unavailable without being able to pick them. | |
| **A6** | **Drivers page: "Off" column / lozenge.** Show "Off Thu-Sun" or similar next to each driver who has an upcoming time-off in the next 14 days. Replace the `<N> / 15` bar with… (see R8 — TBD; for V1 might just show today's job count). | ⚠ R8 |
| 🟡 **A7** | **Add-time-off action.** From the drivers page (per-row "Off…" button) and from the driver edit page. Date range picker only (no reason input). Validation: `ends_on >= starts_on`, both dates must be today or future. | |
| **A8** | **Tests.** Unit on `isDriverOffOn` (boundary days, inclusive ranges, overlapping rows). Integration on the dispatch query (off driver excluded). E2E: mark a driver off, open the dispatch modal, confirm they're in the "Off" group not the candidate list. | |

---

## Fit Check: R × A (provisional)

| Req | Requirement | Status | A |
|-----|-------------|--------|:-:|
| R0 | Per-candidate timeline visible in dispatch modal | Core goal | ✅ |
| R1 | Remove `X / 15 wk` bar from dispatch modal | Must-have | ✅ |
| R2 | Operator can mark a driver off for date / date range | Must-have | ✅ |
| R3 | Off driver hard-excluded from dispatch with clear reason | Must-have | ✅ |
| R4 | Time-off is reversible + audited | Must-have | ✅ |
| R5 | Drivers page reflects who is off today + soon | Must-have | ✅ |
| R6 | Timeline shows enough context (±6h same day) without noise | Must-have | ✅ |
| R7 | "Off" is distinct from `drivers.active = false` | Must-have | ✅ |
| R8 | Replacement for `X / 15` on drivers page | Nice-to-have | ❌ |

**Notes:**
- A6 is flagged ⚠ on the drivers-page workload replacement — that's R8, deliberately a nice-to-have. We can ship V1 without choosing a replacement and revisit.
- All must-haves pass once the three open questions above are answered (granularity, recurring patterns, reason field) — those answers fold into A1/A2/A7 without changing the overall shape.
