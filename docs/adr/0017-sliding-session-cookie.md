# ADR 0017 — Sliding session cookie re-issued by the middleware

**Date:** 2026-09-20
**Status:** Accepted

## Context

Operator sessions are meant to be sliding: 14-day lifetime, extended whenever
a request arrives on a session older than 7 days (`validateSession`). That
refresh only touched the `sessions` row. The cookie was written once, at
login, with `Expires = login + 14 days`, and nothing ever re-issued it — the
`refreshed` flag returned by `validateSession` had no consumer. Exactly 14
days after login the browser dropped the cookie mid-shift: the next server
action returned "Not authenticated." and the next navigation landed on
`/login`. An operator reported this in the week of 16 September 2026.

A server component (the dashboard layout, where the session is validated)
cannot set cookies in Next.js, so the fix cannot live where the refresh is
decided.

## Decision

1. The CSP middleware re-issues the session cookie with `Expires = now + 14d`
   on every document **GET** that already carries one. It does no validation:
   it has no database, and `validateSession` remains the authority — a
   revoked or expired row still ends at `/login`. Only GETs, so a `Set-Cookie`
   written by a server action (login / future logout) is never overridden.
   Only when a cookie is present, so a logged-out visitor is never handed an
   empty session cookie.
2. The lifetime constants move to `session-policy.ts`, which has no DB or
   Node imports, so the edge middleware and the server session store share
   one definition.
3. Console server actions `redirect('/login')` when the session is gone
   instead of returning an error string. The router honours a redirect from
   a server action, so the operator lands on the login screen immediately
   rather than reading a dead-end error.
4. Successful logins write an `audit_events` row (`action = login`, the
   session's expiry, never the token) so future "I got logged out" reports
   can be checked against the operator's last sign-in.

## Consequences

- An active operator is never logged out by the cookie; an idle one still is,
  14 days after their last visit, matching the DB row.
- The cookie may briefly outlive the DB row (cookie slides on every GET, the
  row only after 7 days). Harmless: the row decides.
- The redirect-from-action path has no automated test — it depends on
  `cookies()` from `next/headers`, and the no-mock policy rules out stubbing
  it. It was verified manually against the dev server.
