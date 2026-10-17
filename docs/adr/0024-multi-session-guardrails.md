# ADR 0024 — Guardrails for several sessions working at once

**Date:** 2026-10-18
**Status:** Accepted

## Context

Several Claude sessions now work on this repo concurrently, each in its own worktree (CLAUDE.md §7). The pipeline from ADR 0022 is fast, but its guardrails still assumed one change in flight at a time:

- Branch protection required only `Typecheck · Lint · Test`, and did **not** require the branch to be up to date with `main`. A PR that went green against Monday's main could merge on Tuesday after three other PRs landed. The push-to-main E2E run would then catch the breakage, but only after main was broken and every new worktree had branched from it.
- The two E2E checks were a convention ("never merge a red lifecycle job"), not a rule GitHub enforced.
- Hand-authored migrations (ADR 0022; `drizzle-kit generate` is unusable) have twice collided across branches: two sessions picked the same number, and a journal entry whose `when` did not exceed the previous one was silently skipped by the migrator against the shared local DB while PGlite tests stayed green.
- Coverage thresholds (85% statements / 80% branches on `src/server`) were configured in `vitest.config.ts` but never run in CI, so they enforced nothing.
- Merged branches were never deleted (88 remote branches), and six clean local worktrees pointed at months-old branches.

## Decision

1. **Branch protection on `main`:** required checks are now `Typecheck · Lint · Test`, `E2E smoke` and `E2E lifecycle`, with **"require branches to be up to date"** on. A PR can only merge after CI has run on its branch rebased onto the current `main`, so the combined tree is tested before it lands, not after. "Update branch", auto-merge and delete-branch-on-merge are enabled on the repo. Cost: one extra PR CI run (~3.5 min) when another PR merged first. GitHub's merge queue would remove the manual update step; adopt it if the rebase dance becomes a nuisance.
2. **Migration integrity is a unit test.** `checkMigrationIntegrity` (`src/server/db/migration-integrity.ts`) is pure and runs against the real `drizzle/` folder in `tests/unit/db/migration-integrity.test.ts`, i.e. on every `pnpm test`, in pre-commit and in CI. It rejects: a SQL file without a journal entry, a journal entry without a SQL file, two files sharing a number, a journal `idx` out of position, a tag whose number prefix disagrees with its idx, and a `when` that does not strictly increase. A second branch adding migration `0037` therefore fails on the branch after it updates from main, with a message saying which file to renumber.
3. **CI runs the suite with coverage** (`pnpm test:coverage`) so the configured thresholds fail the verify job. Pre-commit keeps plain `pnpm test` for speed.
4. **`pnpm worktree:new <slug> [type]`** encodes the CLAUDE.md worktree recipe: fetch, branch off fresh `origin/main`, install, copy `.env` with `APP_URL` pointed at a free port from 3100 upward, print the dev-server and lifecycle-E2E commands. It works from inside another worktree.

## Consequences

- A stale-base PR cannot merge; a session whose PR shows "branch out of date" clicks Update branch (or `gh pr update-branch`), waits for CI, then merges or enables auto-merge.
- A merged PR's branch disappears automatically, so `git worktree remove` is the only cleanup left for a session.
- Migration collisions become a red test on the second branch instead of a silent skip in a shared DB. The rule for the loser stays the same: renumber the file and its journal entry, and give `when` a value later than the newest entry on main.
- Coverage drops below threshold now block merge. Simulator.ts sits at 64% statements and is the first file to pull the total down if more untested code is added there.
