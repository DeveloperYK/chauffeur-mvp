# 0006 — Booking service types & a pluggable pricing seam

**Status:** Accepted
**Date:** 2026-05-24

## Context

The booking form modelled every job as a point-to-point trip with a manually
typed duration, and the price was an operator free-text figure. Two problems:

1. The chauffeur trade has two distinct shapes — a **transfer** (A → B, where
   the route determines drive time and cost) and **as-directed / hourly** hire
   (a car at the exec's disposal for N hours, with no destination). Cramming
   both into one form made "no destination" an ambiguous empty field and gave a
   future price calculator nothing reliable to branch on.
2. The company's pricing rules aren't finalised yet, but the *form shape*
   determines what inputs a calculator could ever use, so it had to be decided
   first.

## Decision

- Introduce a first-class **`serviceType`** (`transfer` | `hourly`, default
  `transfer`) on `bookings`, plus `distance_meters`; `dropoff_address` becomes
  nullable (hourly has none). Hourly reuses `expected_duration_minutes`
  (= hours × 60) so the clock/schedule and dispatch overlap logic are unchanged.
- For transfers, drive time + distance are estimated client-side from the route
  via the Maps `DirectionsService` and **auto-fill an editable duration** —
  operators override for traffic/airport buffer. Distance feeds pricing.
- Pricing lives in a pure domain function `quoteBooking(input, rules)`
  (`src/server/domain/pricing.ts`) driven by a single `PLACEHOLDER_PRICING_RULES`
  constant (transfer: `max(min, base + per-mile)`; hourly: `rate × max(hours,
  min)`). The server defaults a booking's price to the quote when the operator
  leaves it blank; the operator can always override. The UI shows the suggested
  price with a breakdown.

## Why this shape

- The placeholder rate card is **deliberately isolated** — when the company
  provides real rules, only `PLACEHOLDER_PRICING_RULES` (and, if needed, the
  `PricingRules` shape) changes; no caller, schema, or UI does. Vehicle-class,
  airport, time-of-day and waiting-time factors slot into `PricingRules` later.
- Route ETA is client-side via the already-loaded Maps SDK (no new server key);
  it degrades to manual entry when Maps is unavailable. Requires the Directions
  API enabled on the Google project.

## Consequences

- New migration `0005_add_service_type`. Backward-compatible: existing rows
  default to `transfer`.
- Multi-stop / return trips remain out of scope (`DESIGN.md §12`); "as-directed"
  covers the "drive me around" case without multi-leg modelling.
- The legacy JJ sheet shows "As directed" for an hourly job's destination; its
  dedicated hourly-rate column is a later refinement.
