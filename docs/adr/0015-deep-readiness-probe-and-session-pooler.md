# ADR 0015 — Deep readiness probe, cron heartbeat, and the session pooler

**Status:** Accepted (2026-09-09)

## Context

From 08:43 UTC on 8 September until 11:12 UTC on 9 September every production
`/dashboard` load failed: the board's reads hit the 15 s guard from ADR 0014
and the operator saw the global error page. Postgres was healthy and the data
tiny; `pg_stat_activity` showed backends that had finished a trivial query and
were waiting 30 s+ for the client's next protocol message. Only the board
(≈10 pipelined parallel queries) was affected; the cron and `/api/healthz`
(single queries) never stalled. The stall lived in Supabase's transaction-mode
pooler (`:6543`) and reproduced only from Vercel's runtime.

Nobody was told. `/api/healthz` runs `select 1`, which stayed green for the
entire 26 hours, and nothing watched production between sessions.

## Decision

1. **Production connects through the session pooler (`:5432`).** Session mode
   binds a client socket to one backend for the socket's lifetime, so pipelined
   extended-protocol messages cannot be split across a transaction boundary
   inside the pooler. Applied as a Vercel env change (`DATABASE_URL`), not code.
   Migrations already used this URL. Pool `max` per instance is kept small so
   the pooler's **30-client** cap holds across a deploy (see addendum).
2. **`/api/readyz` is the monitored endpoint.** `checkBoardPath` runs the same
   five reads the board runs, in parallel, through the same pool, under a 5 s
   budget, and returns 503 with a reason on failure. A timeout also resets the
   pool (ADR 0014). `/api/healthz` stays as a cheap liveness ping.
3. **The clock tick pings a heartbeat URL** (`CLOCK_TICK_HEARTBEAT_URL`) after
   each successful run. The monitor alerts when pings stop — the only way to
   notice a cron that has silently died.
4. **External monitoring + alerting** lives outside Vercel (Better Stack) and an
   hourly Claude routine reads `/api/readyz` and Vercel's error groups and
   emails the owner with a diagnosis when either is bad. See
   `docs/ops/monitoring.md`.

## Consequences

- A pooler stall now shows up as a red `/api/readyz` within a minute, not as an
  operator phone call a day later.
- `select 1` health is explicitly NOT evidence the board works; docs and
  memory say so.
- If session-mode connection counts ever bite, reduce `POOL_OPTIONS.max` before
  considering `:6543` again.

## Addendum (2026-10-11) — the connection cap bit

A routine promote deploy at 21:30 UTC took the board and the clock tick down
for six minutes with `(EMAXCONNSESSION) max clients reached in session mode -
max clients are limited to pool_size: 30`. Session mode admits 30 client
connections in total. Each Vercel function instance held `max: 5`; a deploy
runs the previous deployment's instances alongside the new ones, frozen
instances keep their sockets until Vercel reaps them (~5 min), and the app runs
in two regions — so six-plus live instances exhausted the cap. It cleared on
its own once the old instances were reaped.

Changes:

- `POOL_OPTIONS.max` is now **2** (a unit test pins it), giving ~15 instances
  of headroom instead of 6.
- Self-heal (ADR 0016) now redeploys **only on a timeout**. The `error` the
  full pooler returned triggered a redeploy whose build died on the same error
  in its migration step, burning the hour's cooldown for nothing.
- If the cap bites again: raise *Pool Size* for the session pooler in the
  Supabase dashboard before anything else. Redeploying never frees slots.
