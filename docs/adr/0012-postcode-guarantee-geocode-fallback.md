# 0012 — Postcode guarantee via reverse-geocode fallback (no schema change)

Date: 2026-09-06
Status: accepted

## Context

Every booking address must carry a UK postcode (drivers navigate by postcode).
The Places autocomplete appends the postcode from Place Details, but Google
returns `postalCode: null` for exactly the places operators book most —
airports, terminals and large buildings that span multiple postcodes. When that
happened, a mandatory manual Postcode field forced the operator to do the
lookup's job by hand. Operators also had no explicit way to bypass wrong
suggestions and type an address themselves.

Shaping doc: `docs/shaping/address-postcode-redesign/` (local). Two shapes were
considered: **A** — guarantee the postcode client-side and keep it embedded in
the free-text address; **B** — structured postcode columns in the DB, joined
onto the address at every render surface.

## Decision

Shape A:

1. The single Place Details call fetches `postalCode` **and** `location`
   (both in the same Essentials billing SKU — no extra cost). When
   `postalCode` is null, we reverse-geocode the location with the core
   `google.maps.Geocoder` and take the first full UK postcode from the
   results. Outward-only codes ("TW6") are rejected — not navigable.
2. The postcode stays embedded in the address text. No schema change, and the
   driver page, emails and the sheet mirror are untouched by construction.
3. "Enter address manually" (pinned dropdown row, or Esc) switches the field
   to manual mode: suggestions stay off until the field is cleared or the
   operator clicks "Use lookup". Esc consumes the event so the board's global
   Esc handler doesn't close the whole modal.
4. A "Postcode found: … ✓" line confirms what the lookup produced; the
   operator corrects a multi-postcode building by editing the text. The
   manual Postcode field remains only as a last-resort safety net, and the
   server actions still reject postcode-less addresses.

## Consequences

- Airport-level picks resolve to the airport's central postcode (e.g.
  Heathrow → TW6 …); terminal-level picks keep their exact one. Accepted by
  the user 2026-09-06.
- The geocode call is billed only on the miss path (Place Details had no
  postcode), keeping cost at or below today's.
- Dev/staging have no Places key by policy, so the lookup affordances are
  verifiable only in production (or via an injected `window.google` stub, as
  done for this change's screenshots).
