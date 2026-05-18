# 0002 — Ports and adapters architecture

**Status:** Accepted
**Date:** 2026-05-18

## Context

Domain logic must be testable in milliseconds. Infrastructure (DB, Twilio, Sheets, clock) is slow and flaky in tests. We want a clear seam.

## Decision

- Pure **domain** modules under `src/server/domain/` know nothing about I/O.
- **Ports** under `src/server/ports/` define interfaces (`NotificationPort`, `SpreadsheetMirrorPort`, `Clock`, `IdGenerator`, etc.).
- **Adapters** under `src/server/adapters/` implement ports. Real implementations beside fake implementations (e.g. `TwilioAdapter` + `FakeNotificationAdapter`).
- **Services** under `src/server/services/` orchestrate use cases. They depend on ports, never on concrete adapters.
- The composition root (`src/server/composition.ts`, added in stage 2+) wires production adapters; tests wire fakes.

## Consequences

- Unit tests run fast — no I/O.
- Integration tests use real Postgres but fake everything else, keeping under the budget.
- Adding a new SMS provider is a new adapter, no domain change.

## Rule

Dependencies flow inward: `app` → `services` → `ports` ← `adapters`. Domain depends on nothing. CI lint includes a custom check (future) to enforce.
