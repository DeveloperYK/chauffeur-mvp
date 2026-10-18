# ADR 0025 — `pnpm ship`: merge and promote without the redundant push-to-main run

**Date:** 2026-10-18
**Status:** Accepted

## Context

After ADR 0024 a change still took ~9.5 minutes from PR open to production. Measured on PR #236 (a docs-only change):

| Stage | Time | Needed? |
|---|---|---|
| PR CI (bounded by the lifecycle job) | 3.5 min | yes |
| GitHub auto-merge noticing the green checks | 1.5 min | no |
| Push-to-main CI run, which `pnpm promote` waited for | 3.3 min | no — see below |
| Promote PR + Vercel production build + health checks | 1 min | yes |

Branch protection now requires every PR to be up to date with `main` (ADR 0024). A squash merge of such a PR produces a `main` commit whose **tree is byte-identical** to the PR head's tree (verified on #236: both `dac3480c…`). The push-to-main run therefore re-tests exactly the tree the PR run just passed. ADR 0022 added that run because PRs could merge from a stale base; strict up-to-date removed that case.

## Decision

1. **`pnpm promote` accepts checks from any commit whose tree equals main's tree.** It looks up the PRs associated with main's head, compares tree hashes, and takes the first candidate (main's head or a matching PR head) whose three required checks are green. A direct push or a non-squash merge has no matching PR head and still waits for its own run. The push-to-main workflow keeps running (free on a public repo) as the record for main and as the gate for those cases.
2. **`pnpm promote` waits for the staging deployment of main's head** before checking `/api/readyz`, instead of probing whatever staging happened to be serving. Staging's build applies migrations against real Postgres, so this is the one pre-production check CI cannot give.
3. **`pnpm ship [pr]`** waits for the PR's checks, squash-merges the moment they are green (no auto-merge lag), and runs `promote`. If main moved it updates the branch first and waits again. This is the default way to land a change (CLAUDE.md §11).

## First run (2026-10-18, PR #238) and two fixes

The first `pnpm ship` took 15 min, not 5, for two reasons that were fixed the same night:

- **Commit→PR association lag.** Right after the squash merge, GitHub's "pull requests for this commit" lookup returned nothing, so promote found no matching PR head and waited for the push-to-main run after all. `ship.sh` now passes the head it watched as `PROMOTE_VERIFIED_SHA`; promote still verifies the tree matches.
- **Vercel missed the push webhook.** The `production` branch moved but Vercel never created a deployment; promote timed out after 8 min with production still serving the previous build (correctly — nothing was swapped). The deployment was triggered by hand. Promote now fires the production Deploy Hook (`VERCEL_PROD_DEPLOY_HOOK_URL`, local `.env` only) if no deployment has appeared 75 s after the merge.

## Consequences

- PR open → production drops from ~9.5 min to roughly one CI run plus two Vercel builds: ~5.5 min. Every test still runs on the exact tree that ships.
- The staging wait adds ~1 min that used to hide behind the CI wait; it is the price of exercising migrations on real infrastructure before production.
- If two sessions ship at once, the second's `ship` sees BEHIND, updates its branch, and waits for a fresh CI run — the same cost as before, now automated.
