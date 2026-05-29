---
shaping: true
---

# Driver Availability — Slices

Parent: [shaping.md](./shaping.md). Selected shape: **A**.

Two vertical slices. V1 introduces the new domain concept (time-off) end-to-end; V2 replaces the bandwidth bar with a timeline strip. Splitting because the timeline visualisation has design iteration risk that shouldn't hold up the higher-value availability work.

---

## V1: Mark-off + dispatch exclusion

**Demo:** operator opens the drivers page, clicks "Off…" on Tom, picks Thu–Sun, saves. Opens a dispatch modal for a pickup on Friday — Tom is not in the candidate list; he appears in a small "Off on Fri: Tom" group below. On the drivers page, Tom now shows an "OFF THU–SUN" lozenge.

**Covers parts:** A1, A2, A3 (add `timeOff` to response, keep `weekLoads`), A5, A6 (Off lozenge only — bandwidth bar stays for now), A7, A8 (unit + integration + e2e for the off-path).

**Affordances changed/added:**

| Place | Affordance | Type | Change |
|---|---|---|---|
| `drizzle/NNNN_driver_time_off.sql` | `driver_time_off` table | schema | New table per A1. Migration. |
| `src/server/db/schema.ts` | `driverTimeOff` | schema | Drizzle model. |
| `src/server/services/driver-availability.ts` | `setDriverTimeOff`, `clearDriverTimeOff`, `isDriverOffOn`, `listDriverTimeOff(driverId, fromDate, toDate)` | service | New file. Each mutation writes audit. |
| `src/server/services/bookings-query.ts` | `listDriverDispatchData` | service | Add `timeOff: Record<driverId, Array<{startsOn, endsOn}>>` to response. Keep `weekLoads` for V1 (removed in V2). |
| `src/components/console/types.ts` | `ConsoleDriver`, dispatch data types | types | Add `timeOff` array on driver, or a separate `timeOffByDriver` map at the data root. |
| `src/components/console/dispatch-modal.tsx` | Driver candidate list | UI | Split into two groups: pickable (existing rendering) + "Off on <pickup date>: Tom, Andy" collapsed group at the bottom, non-pickable. Filter by `isOffOn(d.id, booking.pickupAt)`. |
| `src/app/(dashboard)/dashboard/drivers/page.tsx` | Roster | UI | New "OFF <range>" lozenge next to driver name when they have time-off in the next 14 days (today or upcoming). |
| `src/components/drivers/time-off-modal.tsx` | New | UI | Date range picker (whole days, today-or-future). Save / Cancel. Opens from a per-row "Off…" button on the drivers page. |
| `src/app/(dashboard)/dashboard/drivers/actions.ts` | `setDriverTimeOffAction`, `clearDriverTimeOffAction` | server actions | Bind to service; revalidatePath('/dashboard/drivers') + '/dashboard'. |
| `tests/unit/services/driver-availability.test.ts` | New | unit | `isDriverOffOn` boundary cases, overlapping ranges, validation. |
| `tests/integration/services/bookings-query.test.ts` | extend | integration | Dispatch query returns `timeOff` correctly; off drivers still appear in `windows`/`weekLoads` (we don't strip them server-side — the modal does the filter so existing-job context isn't lost). |
| `tests/e2e/lifecycle.spec.ts` | extend | e2e | After seed, mark Andy off for today, open dispatch modal for a today pickup, assert Andy in "Off on" group not the candidate list. |

**Out of V1:** the timeline strip (A4). Drivers-page workload bar replacement (R8). Both stay as-is.

---

## V2: Timeline strip replaces the bandwidth bar

**Demo:** open the dispatch modal — each driver row now shows a small ±6h timeline around the pickup with the candidate slot highlighted and existing jobs as filled blocks. The `<N> / 15 wk` bar is gone. Sort order no longer uses `jobsThisWeek`.

**Covers parts:** A3 (drop `weekLoads` from response), A4, A8 (visual e2e: timeline component renders the candidate window + a near-by job block).

**Affordances changed/removed:**

| Place | Affordance | Type | Change |
|---|---|---|---|
| `src/server/services/bookings-query.ts` | `listDriverDispatchData` | service | Drop `weekLoads` from response and underlying query. |
| `src/components/console/dispatch-modal.tsx` | `WEEK_TARGET`, bandwidth bar, `jobsThisWeek` sort | UI | Removed. Sort becomes tier → not-busy → name (stable). |
| `src/components/console/driver-timeline.tsx` | New | UI | Pure component: input `{ windows: Array<{startMs, endMs}>, candidate: {startMs, endMs} }`, renders a fixed-width strip showing ±6h around the candidate, with blocks for existing jobs and a highlighted candidate slot. |
| `src/app/console.css` | Bandwidth bar classes | UI | Remove `.driver-row__bw*` / `.bandwidth-*` styles; add `.driver-row__timeline*`. |
| `src/components/console/types.ts` | `ConsoleDriver.jobsThisWeek` | types | Remove. Update upstream callers. |
| `src/app/(dashboard)/dashboard/page.tsx` | `jobsThisWeek` field | data | Remove from the dispatch-modal data prep. |
| `src/app/(dashboard)/dashboard/drivers/page.tsx` | "This week" column | UI | Open question for V2: keep the bar here as fairness, or replace with something else (R8 deferred). |
| `tests/unit/components/driver-timeline.test.tsx` | New | unit | Snapshot / interaction: candidate window position, overlap rendering, empty state. |

**Out of V2:** the drivers-page workload bar replacement (R8) is still deferred. V2 only touches the dispatch modal's bar; if we want the drivers-page bar to also go away we'd need to decide what replaces it. Tracked in the shaping doc.
