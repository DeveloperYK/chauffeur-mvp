# 0004 — Content-Security-Policy via nonce middleware

**Status:** Accepted
**Date:** 2026-05-22

## Context

`CLAUDE.md §6` requires a CSP with `default-src 'self'`, no inline scripts, and
nonces for any unavoidable inline. The static headers in `next.config.ts`
(HSTS, `X-Frame-Options`, etc.) shipped, but no CSP did. A naive
`script-src 'self'` cannot work with the Next.js App Router because it emits
inline bootstrap and RSC-streaming `<script>` tags; blocking those breaks
hydration.

## Decision

Add `src/middleware.ts` that sets a per-request CSP:

- A fresh base64 nonce is generated per request and propagated on the **request**
  headers (`Content-Security-Policy` + `x-nonce`). Next.js reads the nonce from
  the request CSP and stamps it onto every script it renders.
- `script-src 'self' 'nonce-…' 'strict-dynamic'` in production. `strict-dynamic`
  lets the nonced bootstrap scripts load the chunked bundles without an
  origin allowlist.
- `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. We keep
  `'unsafe-inline'` deliberately — CSP nonces do not apply to inline `style=`
  attributes, and `components/console/avatar.tsx` sets per-operator background
  colours via inline style. Inline styles cannot execute code, so the residual
  risk is low and accepted.
- `font-src 'self' https://fonts.gstatic.com` for the Google Fonts loaded in
  `layout.tsx`.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`, plus `upgrade-insecure-requests` in production.
- In development the nonce is dropped and `'unsafe-eval' 'unsafe-inline'` are
  allowed so HMR and the error overlay work; `upgrade-insecure-requests` is
  omitted so `http://localhost` assets load.

The matcher excludes `/api/*`, Next internals, and static metadata files so the
CSP applies to documents only and the cron/clock endpoints stay edge-neutral.

Separately, `CLOCK_TICK_SECRET` was moved from a raw `process.env` read in the
route into the Zod schema in `src/lib/env.ts` (optional, min 16 chars) so a
misconfigured deploy fails fast at parse time instead of silently disabling the
clock loop.

## Consequences

- Pages using the nonce render dynamically (no static optimization). The
  operator console is already dynamic (auth, DB reads), so no regression.
- Adding a third-party script or external `connect-src` host now requires a
  conscious CSP edit — intended.
- `style-src 'unsafe-inline'` remains until inline avatar colours are migrated
  to CSS custom properties / data attributes; revisit if styles ever carry
  untrusted input (they do not today).
