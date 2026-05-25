---
shaping: true
---

# S1/S2 Spike: Server-side booking search engine

### Context

Shape A (command palette) and its requirements R1–R3, R7, R10 all rest on a
server-side search (`S1` service + `S2` index) that doesn't exist yet — today
search is client-side `.includes()` over the loaded day. We need to know
*concretely how* to build a global, live, performant match across booking ref,
driver name, exec/passenger name, and the retained text fields before we can
mark those requirements ✅ and slice.

### Goal

Identify the concrete matching strategy, the index/migration needed, and the
query shape — including how to match the `BKNG-00042` reference and the joined
driver name — such that it works in **both** production Postgres (Supabase) and
the **PGlite** integration-test DB, within the p95 < 200ms bar.

### Questions

| # | Question |
|---|----------|
| **X1-Q1** | What's the realistic row scale (bookings/day × retention) that the query must stay fast on? At that size, is plain `ILIKE '%term%'` across columns acceptable, or do we need an index strategy? |
| **X1-Q2** | Does **PGlite** (the integration-test DB, `createTestDb()`) support `pg_trgm` GIN indexes and/or `tsvector`? If not, the index strategy must degrade to something testable the same way in CI — what's the common subset between Supabase and PGlite? |
| **X1-Q3** | **Decided: keep the `BKNG-00042` display format (no change to UI/messages/#49); make search flex-match the number.** So: normalise the query (strip a leading `bkng`/`#`, ignore case + leading zeros) and match against `seq` — `42`, `00042`, `bkng-42`, `BKNG-00042` all resolve to booking #42. Confirm where `bookingRef`/`BOOKING_REF_PREFIX` live and the cleanest place to normalise (client vs SQL). Should a bare integer be treated as an **exact `seq` hit** (ranked first) vs a substring? |
| **X1-Q4** | How do we match **driver name** in one query — join `drivers` on `assigned_driver_id` and `OR` an `ILIKE` on `drivers.name`? How does Drizzle express the join + OR-group cleanly, and does it stay indexable? |
| **X1-Q5** | What ranking/ordering do we want (exact ref hit first → prefix → substring; then by `pickupAt`)? How do we bound results (limit + cursor) so R7 holds and the palette stays snappy? |
| **X1-Q6** | What's the transport for a live, debounced query from the client palette — a Server Action, a Route Handler (`/api/...`), or a server-component search param? What does the codebase already use for read-style fetches, and which gives the lowest latency + easiest cancellation of stale keystrokes? |
| **X1-Q7** | Should the search reuse/extend `bookings-query.ts` (add `searchBookings`) or be a new module? What's the cleanest seam given the architecture rule (app → services → db)? |

### Acceptance

Spike is complete when we can describe: the matching strategy (and why it works
on both Supabase and PGlite), the exact migration/index for `S2`, the `S1` query
shape including ref + driver-name matching and ranking/bounding, and the
client↔server transport for live results — i.e. enough to flip R1–R3, R7, R10
from `⚠️→spike` to ✅ and write `V*-plan.md`.
