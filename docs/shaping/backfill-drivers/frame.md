---
shaping: true
---

# Backfill Drivers — Frame

## Source

> The next feature I want to focus on is handling backfill drivers for context
> the chaffeur company has 30-40 drivers but there are times when drivers are
> not available - in this case they have a backfill which is essentially a group
> chat where they put the booking details in people react with a thumbs up. The
> operator then reaches out to them to get their details make sure they are
> legit and they handle that booking. We dont have to automate the whole process
> espeically for mvp but i just want a way of handling this the system should be
> flexible enough to deal with this usecase

Relevant prior scoping (`DESIGN.md`):

> §1.5 — If no employee driver accepts, the operator falls back to a **WhatsApp
> group of subcontractor backfill drivers** — first-to-reply wins.

> §2 (Non-goals) — **No backfill subcontractor workflow.** Subcontractors
> continue to use the existing WhatsApp group. The client has confirmed this is
> rare and not a priority.

> §3 — **Subcontractor backfill driver | Out of MVP | No change.**

This feature deliberately reopens that scoped-out corner — minimally.

---

## Problem

When no internal driver is free, the operator drops out of the system entirely:
they post the booking to the subcontractor WhatsApp group, someone 👍s, the
operator vets them by hand and that driver does the job. The booking, meanwhile,
sits `unassigned` (or gets force-closed), so the **live board, the automated exec
confirmations, and month-end invoicing all lose track of a job that actually ran**.

There is no representation of "a job ran, but not with one of our drivers."

## Outcome

An operator can hand an `unassigned` booking to a backfill driver, record who is
covering it, and carry it through to `completed` — the exec still gets their
confirmations, invoicing still counts the job, and it is marked as subcontracted —
**without** the system trying to run the group chat, the 👍 reactions, or the
vetting. Those stay manual.

## Out of scope (MVP)

- Automating the WhatsApp group chat or the 👍-to-claim mechanic.
- Vetting / legitimacy checks (operator does this by hand, outside the system).
- A reusable subcontractor roster (each backfill is entered fresh — see R7).
- Subcontractor-specific pay / cost accounting (we flag the job; finance handles £).

## Related shaping

- `docs/shaping/driver-availability/` — *which* internal driver to pick (workload
  / availability signal). Adjacent: it governs the step **before** backfill (is any
  internal driver available?). Backfill is the fallback when the answer is no.
