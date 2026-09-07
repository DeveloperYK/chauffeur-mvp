# ADR 0014 — Fail fast on a hung database pool

**Status:** Accepted (2026-09-07)

## Context

Since 5 July production has logged 19 `Vercel Runtime Timeout Error: Task
timed out after 300 seconds`, always on `/dashboard`. On 7 September a burst of
them caught an operator mid-create: the modal sat on "Creating…" for minutes.

The database was healthy throughout (`/api/healthz` and the clock-tick cron kept
answering). One dashboard function instance had a wedged `postgres-js` pool:
every query routed to it waited forever, and nothing bounded that wait. The
pool opened up to 10 connections per instance with no connect timeout, no
maximum lifetime and no keepalive, on a host that freezes idle instances and
behind a transaction-mode pooler that drops idle client sockets. Whatever the
exact trigger, the failure mode was "wait 300 s, then die" with no self-repair.

## Decision

1. **Bound the wait client-side.** `withDbTimeout(label, ms, work, onTimeout)`
   races database work against a deadline. The board render and the create
   action use it (`DB_TIMEOUT_MS.page` = 15 s, `.action` = 20 s).
2. **Self-heal on the deadline.** The timeout callback is `resetDb()`, which
   destroys every socket in the cached pool (`client.end({ timeout: 0 })`) and
   forgets it, so the next request on that instance opens fresh connections
   instead of queuing behind stuck ones.
3. **Pool hygiene.** `max: 5`, `connect_timeout: 10`, `max_lifetime: 10 min`,
   `keep_alive: 30` (see `POOL_OPTIONS`). Fewer pooler slots per instance and
   sockets are recycled rather than trusted indefinitely.
4. **Route backstop.** `/dashboard` exports `maxDuration = 60` so even a hang
   the guard misses is cut at one minute, not five.
5. **Honest UI.** On a timeout the create action returns a message telling the
   operator to check the board before retrying (the write may have landed);
   the modal also catches a transport failure so the button never stays on
   "Creating…".

## Consequences

- A wedged instance now costs one slow request (≤ 20 s) and repairs itself.
- A timed-out create is ambiguous by nature; the message says so. Duplicate
  detection is not in scope.
- Other server actions still rely on the 60 s route backstop; wrap them with
  `withDbTimeout` if they show the same symptom.
