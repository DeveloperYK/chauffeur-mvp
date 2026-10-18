# ADR 0026 — "Copy booking" instead of recurring bookings

**Date:** 2026-10-18
**Status:** Accepted

## Context

An operator asked for a way to fill out the create form from historical bookings: most jobs are repeats (same exec and PA, same route, same price, often the same weekday). Two shapes were possible: true recurring bookings (a series the system expands), or a copy flow that pre-fills the form from any past booking.

## Decision

Build the copy flow, not a series. `DESIGN.md` §2 lists recurring bookings as out of scope, and a series would need "this one or the whole series" semantics on every edit, cancel, dispatch and exec email — a large surface for a four-operator team. Copying gets almost all of the time saving at a fraction of the risk: for a weekly job the operator copies last week's booking and changes the date.

- **Entry points:** a "Copy booking" button in the detail panel header (any state, including completed and cancelled), and a "Copy from" search box at the top of the create form that looks up past bookings by passenger, company, address or reference.
- **What copies** (`src/lib/booking-template.ts`, pure, shared by client and server): service type, flight/train, requested car type, route with its estimated distance and duration, passenger, exec contact, PA (booked-by) details, customer account, case code, contract and subcontractor prices, driver notes and operator notes.
- **What never copies:** pickup time (defaults like a blank form), driver and assignment, state, and every completion figure (waiting, car park, arrival/on-board/drop-off times, overrides).
- The postcode rule still applies to the copied addresses, so copying a legacy booking without a postcode prompts for one — the same prompt the edit flow gives.

## Consequences

- No schema change; a copied booking is an ordinary new booking with no link back to its source.
- If operators later want "repeat every Monday", it can be layered on top of this template as a generator of ordinary bookings, still without series semantics.
