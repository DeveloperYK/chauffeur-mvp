# 0003 — Session management without Lucia

**Status:** Accepted
**Date:** 2026-05-18

## Context

`CLAUDE.md` originally specified Lucia v3 for operator auth. Lucia v3 is officially in maintenance-only/deprecated status — the maintainer's recommendation is to copy the patterns into your codebase rather than depend on the library.

## Decision

Roll a minimal session manager in `src/server/auth/`:

- Generate a 256-bit random session token (base64url) at login.
- Store the **SHA-256 hash of the token** as `sessions.id` in the database (so a DB leak cannot impersonate users).
- Set an HTTP-only, `Secure`, `SameSite=Lax` cookie carrying the raw token.
- Sliding 14-day expiry — refresh the cookie + DB row when more than 7 days have elapsed since the last touch.
- Constant-time comparison when looking up sessions.

Password hashing uses Argon2id via `@node-rs/argon2` with sane defaults.

Login rate limit: an in-memory leaky-bucket per email (5 attempts / minute, exponential backoff). Acceptable for MVP given operators all hit the same Node process. Documented to be replaced with Redis when we horizontally scale.

## Consequences

- Zero auth dependencies beyond the password-hash crate.
- ~150 lines of auth code we fully understand and can audit.
- Tests cover password hash roundtrip, session lifecycle, rate limit, and the login server action end-to-end.

## Alternatives

- **NextAuth/Auth.js**: heavier, more configuration surface, oriented at SSO providers we don't need.
- **Keep Lucia**: deprecated upstream; risk that future bug fixes never arrive.
