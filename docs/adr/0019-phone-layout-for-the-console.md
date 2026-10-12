# ADR 0019 — One console, laid out for the phone (supersedes 0018)

**Status:** accepted · 2026-10-12 · supersedes [0018](./0018-mobile-shell.md)

## Context

ADR 0018 shipped a separate phone UI at `/m` (day list, booking screen, new-booking screen) with the middleware routing phones to it by user agent. After using it the operator's verdict was that the separate dashboard was "kinda useless": it was a second product to learn, showed less than the board, and still needed the full console for anything outside its narrow scope. The ask became: keep the existing web design, just make it work clearly on an iPhone.

## Decision

1. **There is one console.** The `/m` route group, its components, the per-state action rules, the UA routing and the `console_mode` cookie are removed. Phones open `/dashboard` like everything else.
2. **The phone layout lives in CSS, in one block.** The `@media (max-width: 768px)` block at the end of `console.css` restyles the console for a phone held upright: the rail becomes a horizontal nav strip; the board's columns stack one under another and empty columns hide (`:has()`), so Unassigned is at the top and nothing scrolls sideways; the list's table rows reflow into stacked rows via `grid-template-areas`; the detail panel and every modal become full-screen sheets with one full-width primary button above the home bar; inputs are 16px so iOS does not zoom.
3. **Modal widths are classes, not inline styles** (`modal__card--sm|lg|xl`), so the phone block can override them without `!important`.
4. **WhatsApp hand-off picks the target on the client.** Offer, change and completion links are minted on the server as WhatsApp Web links (which cannot know the device). `components/console/whatsapp-link.tsx` renders them, and on a phone rewrites to `wa.me` via the pure `whatsappLinkForPhone`. The breakpoint it uses (`use-is-phone.ts`) is the same one as the CSS so the two never disagree.
5. **The dashboard page keeps its read model.** `services/console-view.ts` keeps `toConsoleBooking` / `toConsoleDriver` (the board page uses them); the shell-only loaders are gone.

## Consequences

- No second surface to keep in step with the board: a new console action works on the phone the day it ships, as long as it respects the layout block (full-width primary action, no fixed widths).
- The Playwright `mobile` project (iPhone 13 preset) stays and `tests/e2e/mobile.spec.ts` now drives the console itself: no redirect, no horizontal overflow, stacked columns, full-screen sheets, create → dispatch (confirmed by phone, `wa.me`) → approve → edit → cancel/undo. `pnpm test:e2e:mobile`.
- `:has()` is required for hiding empty columns (Safari 15.4+, Chrome 105+). Older browsers show the empty columns; nothing breaks.
- Desk-only pages (calendar, drivers, invoicing) keep their earlier "don't clip" rules; they are readable on a phone, not redesigned for it.
