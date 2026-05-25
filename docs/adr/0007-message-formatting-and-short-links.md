# 0007 — Message formatting & self-hosted short links

**Status:** Accepted
**Date:** 2026-05-25

## Context

Driver/exec messages read like debug output: raw `2026-05-23 14:00 UTC`
timestamps and ~200-character signed `/j/<jwt>` links. Operators asked for a
more professional format and a URL shortener.

## Decision

- **Structured, branded message bodies** (multi-line, 24-hour Europe/London
  time via `formatLondonDateTimeShort`), centralised in `sms-templates.ts` and
  reused for the manual WhatsApp links so SMS and WhatsApp stay identical.
- **Self-hosted branded short links** rather than a third party (Bitly et al.):
  - `short_links` table (`code` → absolute `destination`); `createShortLink`
    mints a random unambiguous 7-char code; `/s/[code]` route 302-redirects to
    the stored `/j/<token>` URL.
  - Minted in `generateDispatchLink` / `generateCompletionLink`; the driver
    SMS/WhatsApp carry `…/s/<code>` instead of the long token URL.

## Why self-hosted

- **Privacy:** clients' booking links never leave our infrastructure (a
  premium private-client service shouldn't hand booking URLs to Bitly).
- **No new dependency / secret / rate limit**, and it works today on the app
  domain. The token still gates access at `/j`; the code is an opaque lookup
  key, so the short link itself leaks nothing.

## Consequences

- New migration `0007_add_short_links`; auto-applies on deploy.
- The path shortens (the long JWT is gone) but the domain stays
  `chauffeur-mvp.vercel.app` until/unless a short domain is purchased.
- Short links are not currently expired/GC'd — cheap rows; revisit if volume
  ever warrants a cleanup job. The underlying token already expires.
