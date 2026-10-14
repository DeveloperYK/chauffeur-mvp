# ADR 0020 — Self-service password reset for operators

**Date:** 2026-10-14
**Status:** Accepted

## Context

Until now a locked-out operator had no way back in except an engineer running
`scripts/create-operator.ts` on a fresh email. One operator forgot their
password and needed a reset; the same will happen again. The console already
has a transactional email channel (Resend, behind `EmailPort`) and a
`must_change_password` flag used for temporary passwords.

## Decision

1. **Two paths, one service module** (`src/server/auth/password-reset.ts`):
   - `adminResetPassword` — run from `scripts/reset-operator-password.ts` by an
     engineer. Sets a (usually temporary, `--temp`) password, revokes every
     session, writes an `admin_password_reset` audit row. No deploy needed.
   - `requestPasswordReset` / `completePasswordReset` — the self-service
     "Forgot your password?" link on the sign-in screen.
2. **Token design.** A 32-byte random base64url token is emailed in a link to
   `/reset-password?token=…`. Only its SHA-256 is stored, in a new
   `password_reset_tokens` table (migration 0034), with `expires_at` =
   request + 30 min and `used_at` for one-shot use. Requesting a new link
   consumes earlier unused ones. Completing a reset also clears
   `must_change_password` and revokes all sessions.
3. **No account enumeration.** The request form always reports success for
   unknown or deactivated emails. The one exception is a provider failure
   (`email_failed`), surfaced so a real operator is not left waiting; with
   four known operators this is an acceptable trade.
4. **Rate limit** per email (3 per 15 min, exponential lockout) via the
   existing in-memory `RateLimiter`. Same per-instance caveat as login on
   serverless; the token itself is the real defence.
5. **Email** reuses the branded exec-email layout (`renderBrandedEmail`) with a
   `cta` button and an "Account security" footer label instead of "Booking
   notification".

## Consequences

- Operators recover their own account without engineering help.
- Engineers still have a CLI path that works before this is deployed.
- Reset links are useless after 30 minutes or once used; a leaked DB dump
  reveals only hashes.
- `APP_URL` must be the public console origin in every environment that sends
  real email (it already is for staging and production).
