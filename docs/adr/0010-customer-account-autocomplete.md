# 10. Customer-account autocomplete scoped to month + recent history

Date: 2026-06-01

## Status

Accepted

## Context

The monthly invoice (`reconcile`) groups completed bookings by the **exact**
`accountCode` string. So "Lego", "lego", and "LEGO Group" become three separate
account groups on the same invoice — a data-quality problem that an operator
only notices at month-end, when it is tedious to fix across many bookings.

The accounts are free text captured during a phone call, so typos and wording
drift are inevitable when each booking is typed from scratch.

## Decision

Add a typeahead to the Customer-account field on the create and edit booking
modals. As the operator types, it suggests **distinct account strings already
used**, so they reuse an existing spelling instead of minting a variant.

The suggestion source is scoped to the booking's **pickup month plus the
previous `ACCOUNT_SUGGESTION_LOOKBACK_MONTHS` (3) months**, across every booking
state, target-month accounts first:

- *Pickup month* (not the current calendar month) is what matters, because that
  is the month the booking will be invoiced under.
- *Including recent months* means the **first** booking of a brand-new month
  still autocompletes from recent history, instead of starting from a blank
  slate (the weakness of a strict month-only scope).
- *All states* (not just completed) so the second booking of the month matches
  the first even though neither has been completed yet.

The field stays a plain text input — picking a suggestion is optional and a
brand-new account can always be typed. Nothing is enforced server-side; this is
a consistency nudge, not a constraint.

## Consequences

- Invoices fragment far less; operators converge on one spelling per account.
- The lookup (`accountSuggestionsAction` → `listAccountCodeSuggestions`) is
  best-effort: it returns `[]` on any error or invalid month and never blocks
  creating a booking.
- It does not retroactively merge existing variants, and it does not dedupe
  case-insensitively in the report — two genuinely different spellings already
  in the data still invoice separately until edited.
- Suggestions are read-only and bounded (50 accounts, 8 shown); past ~100k
  bookings the windowed scan may want an index on `(account_code, pickup_at)`.
