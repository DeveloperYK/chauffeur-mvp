# ADR 0022 — Faster path from push to production

**Date:** 2026-10-15
**Status:** Accepted

## Context

Getting one change into production took roughly 19 minutes of waiting, measured over PRs #219–#225:

| Stage | Time | Cause |
|---|---|---|
| Local gate before push | ~4 min | pre-commit (biome, typecheck, tests) plus a mandated local run of the lifecycle E2E (2.5 min) that CI repeats on every PR |
| PR CI | 5.5–6.5 min | the two E2E jobs waited for the verify job (2 min) before starting; lifecycle alone is ~4 min |
| Push-to-main CI + staging deploy | ~2 min | fine |
| Promote PR (`main → production`) CI | ~6 min | the full workflow, including both E2E jobs, re-ran on the commit main had just verified |
| Production build | ~47 s | fine |

Two further costs sat inside the verify job: the unit + integration suite took 66 s on the 2-core runner (11 s on a laptop) against a 75 s hard guardrail, and the job started a Postgres service it never used (tests run on PGlite, `next build` opens no connection). Profiling showed the suite's dominant fixed cost was booting ~50 fresh PGlite instances (`initdb` ≈ 400 ms each); applying the 36 migrations on top costs only ~25 ms.

## Decision

1. **Promote PRs skip CI.** The workflow's `pull_request` trigger ignores PRs whose base is `production`. A promote PR's head is main's head commit, which already carries the `Typecheck · Lint · Test` check from the push-to-main run; branch protection reads required checks off the commit, so the PR is mergeable as soon as that run is green. `scripts/promote.sh` (`pnpm promote`) encodes the whole promotion: verify main's check, verify staging `/api/readyz`, open and merge the PR, wait for Vercel's production deployment via GitHub's deployment statuses, check production `/api/healthz` and `/api/readyz`.
2. **E2E jobs no longer `need` verify.** They start alongside it, so PR CI takes as long as the lifecycle job alone. Chromium is cached by Playwright version instead of downloaded per job.
3. **Verify job drops its Postgres service.**
4. **Test databases boot from a snapshot.** A vitest `globalSetup` boots one PGlite, applies every migration, and saves its data dir under `node_modules/.cache/pglite-template/`, keyed by the migration SQL and the PGlite version. `createTestDb()` loads that snapshot (~90 ms) instead of running `initdb` (~400 ms), and falls back to the old path when no snapshot exists. Each test still gets its own isolated database.
5. **Local lifecycle E2E is required only when the change can affect it** (state transitions, state-aware console actions, the simulator, the console surfaces, or the spec itself). CI runs the identical spec on every PR and remains the gate; a PR with a red lifecycle job is never merged. CLAUDE.md §11 states the rule.

## Consequences

- Push to production drops from ~19 min to roughly 8 min of waiting, with every check still run at least once on every change.
- The push-to-main CI run is now load-bearing: it produces the check the promote relies on. It must stay in the workflow.
- `production` only ever receives commits that were on `main`; a hotfix must land on `main` first, then promote. This was already the rule.
- A new migration invalidates the test snapshot automatically (the cache key includes the SQL). Deleting `node_modules/.cache` forces a rebuild.
- Chromium cache misses once per Playwright upgrade.

## Rejected

- **Auto-promote on green main.** Staging is where the user looks before operators see a change; keep promotion a deliberate command.
- **Larger GitHub runners / test sharding.** Larger runners need a Team plan; sharding adds ~25 s of per-job setup for a ~66 s suite. Removing the fixed boot cost was cheaper and also helps locally.
- **Fast-forward push to `production`.** Branch protection forbids direct pushes, and the merge commit keeps a visible promotion record.
