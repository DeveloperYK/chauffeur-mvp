# ADR 0018 — Mobile shell at `/m`, routed by middleware

**Status:** accepted · 2026-10-11

## Context

Operators are sometimes out when an urgent booking arrives and must add or fix it from a phone. The console's phone experience was the desk layout squeezed through one media query (see `docs/shaping/mobile-shell/shaping.md`). The user chose a dedicated phone UI for the core booking flow over a fully responsive console.

## Decision

1. **A second client, not a second backend.** `/m` is a route group with its own layout and three screens (day list, new booking, booking). It calls the existing server actions and services. The booking serializer moved from the board page into `services/console-view.ts` so both surfaces render the same `ConsoleBooking`. The console's dispatch, edit, cancel and create modals are reused as-is and made full-screen by CSS scoped under `.m-app`.
2. **Routing happens in the middleware from the request alone.** `isMobileClient` trusts the `sec-ch-ua-mobile` client hint, then falls back to a UA test (iPad counts as desk). Phones opening `/dashboard` (or `/dashboard/bookings/:id`, `?booking=`, `?new=1`) are 307'd to the mobile equivalent. Desk-only pages (calendar, drivers, invoicing, simulator) are never redirected, so the simulator remains usable from a phone and E2E tests can drive it.
3. **The choice is explicit and sticky.** `?console=desktop` sets a 1-year `console_mode` cookie and lands on the board; `?console=mobile` clears it. The decision logic is a pure function (`lib/console-mode.ts`) with unit tests; only document GETs are considered so server-action POSTs are never redirected.
4. **Presentation rules are pure modules.** Which bookings need the operator (`lib/mobile-sections.ts`) and which actions a state offers, with exactly one primary (`lib/mobile-actions.ts`), are unit-tested without React.
5. **WhatsApp on a phone uses `wa.me`.** `whatsappWebLink` targets WhatsApp Web, which does not run in a phone browser; the shell passes `mobile` to the dispatch modal, which rewrites offer links with `whatsappMobileLink`.

## Consequences

- Type-only imports now cross from `server/services/console-view.ts` to `components/console/types.ts`. They carry no runtime dependency; the shapes stay with the client that consumes them.
- Desk-only tools are a tap away via "Full console" but are not rebuilt for phones. If one of them becomes a field need, it gets its own mobile screen rather than a responsive pass.
- A new Playwright project (`mobile`, iPhone 13) runs `tests/e2e/mobile.spec.ts` against a dev server; it is the only test that exercises the middleware redirect and the sheets at phone size. Run with `pnpm test:e2e:mobile`.
