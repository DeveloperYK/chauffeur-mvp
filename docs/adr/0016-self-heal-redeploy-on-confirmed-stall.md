# ADR 0016 — Self-heal: redeploy production on a confirmed board-path stall

**Status:** Accepted (2026-09-10)

## Context

ADR 0015 added `/api/readyz`, external monitoring and an hourly Claude
watchdog. All of it *detects*; nothing *repairs*. The owner asked for the one
remediation that has fixed the recurring failure — a redeploy of the current
production deployment, which replaces every function instance and its
connection pool — to happen automatically on a confirmed pooler stall.

Where to run it was the real question:

- The hourly cloud watchdog cannot: its sandbox egress policy blocks
  `api.vercel.com` and the production domain, the Vercel connector's fetch tool
  only serves deployment URLs, the `production` branch requires PR review so an
  empty-commit push is rejected, and the agent (correctly) refuses to fire a
  production redeploy unattended.
- Better Stack outgoing webhooks are a paid feature.
- The clock-tick cron already runs every minute inside Vercel, where the Deploy
  Hook is reachable, the database is at hand for a lock, and no agent judgement
  is involved.

## Decision

`selfHealRedeploy` runs at the end of every clock tick when
`VERCEL_DEPLOY_HOOK_URL` is set (a Vercel Deploy Hook for the `production`
branch — the hook only ever builds that branch, so it cannot deploy anything
unreviewed):

1. **Cooldown first.** If an attempt is recorded in `audit_events`
   (`action = self_heal_redeploy`) in the last 60 minutes, stop. Checked before
   probing so a cooling instance spends nothing.
2. **Confirm.** Run `checkBoardPath` (the readyz probe). If it fails, wait 15 s
   and run it again. Only two consecutive failures count; a blip that recovers
   is logged and ignored. Both `timeout` (the pooler stall) and `error` (e.g. a
   migration that did not run — a redeploy re-runs migrations) qualify.
3. **Act.** `POST` the hook with a 10 s abort. Record an audit row with the
   probe result and hook status **whether or not the hook accepted**, so a
   failing hook also starts the cooldown rather than being retried every
   minute. Log at `error` before and `warn` after so the watchdog and Vercel
   error groups both see it.
4. **Never throw.** The tick must keep transitioning bookings whatever the
   self-heal does. It runs after the tick and the heartbeat ping.

`/api/clock-tick` exports `maxDuration = 60` to accommodate the ~25 s confirm
window.

## Consequences

- A pooler stall is now repaired within ~2 minutes of appearing, at most once
  an hour, with a durable audit trail and a log line the hourly watchdog
  reports in its email.
- Deploy Hook URL is a secret (anyone holding it can trigger production
  builds). It lives only in Vercel env; never log it.
- If a redeploy does not clear the fault, the system does not escalate by
  itself — the cooldown holds and the monitors/watchdog keep alerting the
  owner, which is the intended hand-off to a human.
- Rollback: unset `VERCEL_DEPLOY_HOOK_URL`.
