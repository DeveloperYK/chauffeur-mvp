# 0001 — Tech stack

**Status:** Accepted
**Date:** 2026-05-18

## Context

We need a stack that supports a small dashboard, public link pages, scheduled jobs, and SMS/Sheets integrations, with a < 60s test suite and principal-engineer code quality. Solo dev. Production-grade.

## Decision

- **Next.js 15 (App Router)** for both the operator dashboard (server actions) and the public driver-link routes (Route Handlers + dynamic segment).
- **TypeScript strict** with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Drizzle ORM** over Postgres 16. Typesafe, fast, SQL-first migrations.
- **Lucia v3** for session-based operator auth.
- **Zod** for every trust-boundary validation.
- **Vitest** (unit + integration) and **Playwright** (e2e smoke).
- **Biome** for lint + format (single tool, fast).
- **pnpm** for deps.
- **Pino** for structured logging.
- **jose** for JWT signing of driver links (HS256 + per-env secret).
- **@node-rs/argon2** for password hashing.

## Consequences

- One codebase, one deploy unit. Lower operational complexity.
- Tight coupling between dashboard and public API; we mitigate with the ports/adapters architecture (see `CLAUDE.md` §4).
- Drizzle migrations are SQL, reviewable in PRs.
- All secrets via env; never committed.

## Alternatives considered

- Fastify backend + Vite React frontend: more boilerplate, more deploy surface.
- Django + DRF: slower iteration in TS-heavy team. Battle-tested but mismatched here.
