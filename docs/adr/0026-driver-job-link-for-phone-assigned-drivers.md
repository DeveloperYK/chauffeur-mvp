# ADR 0026 — A job link for drivers assigned by phone

**Date:** 2026-10-18 · **Status:** Accepted

## Context

A driver who accepts a dispatch offer keeps that signed link as their persistent
job view (`/j/<token>` shows the booking once the offer is consumed). A driver
the operator commits by phone (`assignDriverDirect`, `assignment_method =
operator_attested`) never receives a link at all, so they have nothing in hand
with the pickup time, addresses and passenger — the operator ends up re-typing
the booking into WhatsApp and the driver loses track.

## Decision

- A new service, `generateDriverJobLink`, mints a **`dispatch`-type token signed
  for the booking's current assigned driver** and returns the long URL, a
  branded short link, a WhatsApp Web deep link and the formatted message
  (`driverJobSms`: "Your job BKNG-… / Details: <url>", no Accept wording).
- It is allowed only while the driver still needs the job in front of them:
  `assigned` and `in_progress`. Later states use the completion link; backfill
  bookings have no app driver and are refused (`no_driver`).
- **No dispatch offer is recorded.** The token type is reused so the existing
  driver page renders the job view unchanged, but the booking is already
  taken — an open offer row would wrongly surface "Offered to N · awaiting".
- The token's access rule is unchanged: `previewDriverJob` only serves the
  booking's *current* assigned driver, so a link issued to a driver who is later
  swapped out goes dead (`not_your_job`). Expiry is pickup + 48h.
- Every mint writes a `driver_job_link_generated` audit row.
- Console: "Confirmed by phone" now keeps the dispatch modal open with the new
  driver's job link (send on WhatsApp / copy) instead of closing straight away;
  leaving the modal by any route reports the assignment so the board refreshes.
  The detail panel gains "Job link for driver" on assigned and in-progress
  bookings so the link can be re-issued (driver lost the message, link-accepted
  driver needs it again).

## Consequences

- The phone-assign path now has the same "link ready" hand-off as the fan-out,
  with one row and no "signed for one driver" warning (there is only one).
- If minting the link fails after a successful assignment, the assignment stands
  and the modal closes with the usual toast; the panel button is the retry.
- The lifecycle E2E covers assign-by-phone → open the link → job view, and the
  panel re-issue.
