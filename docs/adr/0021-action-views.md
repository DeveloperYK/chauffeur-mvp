# ADR 0021 — Rail "action views" named for the operator's next step

**Date:** 2026-10-14
**Status:** Accepted

## Context

The console rail had five "saved views": Unassigned tickets, Awaiting review,
No price, Driver not told, Emails due. Operators found them confusing:

- Labels mixed booking *states* ("Awaiting review") with operator *tasks*
  ("Emails due"), and one ("Driver not told") hid both its trigger (an edit
  after dispatch) and its remedy (get the driver to confirm).
- Two lifecycle stages had no view at all. After the clock ends a trip
  (`awaiting_driver_form`) the operator must send the driver the completion
  form, but nothing in the rail said so. At the front, an unassigned booking
  whose dispatch links were out and unanswered looked identical to one nobody
  had dispatched.
- Every count was red, so red carried no information.

The rail's purpose is to show where an operator has to act. It should read as
a to-do list.

## Decision

1. **Every view is an imperative** naming the next step, ordered along the
   lifecycle, and grouped by who the ball is with:
   - *To do* — Dispatch · Tell driver of change · Send completion form ·
     Approve completion · Send exec emails
   - *Waiting on others* — Driver to accept · Driver form outstanding
   - *Billing* — Add price
2. **Red means overdue, not non-zero.** *To do* and *Billing* counts are red
   whenever non-zero. *Waiting* counts are grey until a booking crosses a
   threshold: the existing 24 h no-accept flag for "Driver to accept"; 24 h
   since the last send for "Driver form outstanding".
3. **"Dispatch" and "Driver to accept" split the unassigned state** on whether
   an `open` row exists in `dispatch_offers`. No new data: offers already
   lapse on accept, release and cancel.
4. **"Send completion form" and "Driver form outstanding" split
   `awaiting_driver_form`** on a new nullable `bookings.completion_link_sent_at`
   (migration 0035). `generateCompletionLink` stamps it (the modal exists only
   to copy or WhatsApp the link, so generated ≈ sent; last send wins).
   `rejectBooking` clears it so a bounced form re-prompts the operator. The
   simulator's force-state clears it too. Operator-entered completion bypasses
   it by design.
5. **One registry, two halves.** `src/lib/action-views.ts` holds the pure
   metadata (ids, labels, groups, one-line subtitle, colour) so the client
   rail can import it. `src/server/services/action-views.ts` holds one SQL
   predicate per view, shared by `listActionView` and `countActionViews`, so a
   badge can never disagree with its list. "Send exec emails" is the exception:
   its rule needs the email send log, so it reuses `listEmailAttentionBookings`.
6. **View ids changed** (`to_dispatch`, `confirm_change`, `send_form`,
   `form_outstanding`, `approve`, `send_emails`, `add_price`,
   `driver_to_accept`). An unknown `?savedView=` falls back to the day board,
   so stale bookmarks degrade gracefully.
7. Each view page shows its selection rule as a one-line subtitle, and the
   board tile marker "driver not told" is now "change not confirmed".

## Consequences

- Eight small count queries per console render instead of five (all on
  indexed `state`). Acceptable for four operators; revisit if the rail ever
  becomes hot.
- A completion link generated but never actually sent will sit under "Driver
  form outstanding" rather than "Send completion form". Re-generating moves
  nothing but refreshes the 24 h clock; the panel still offers "Enter
  completion details" either way.
- `listUnpricedBookings` was removed; `add_price` carries the same predicate.
