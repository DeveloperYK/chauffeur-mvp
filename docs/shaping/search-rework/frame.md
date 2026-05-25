---
shaping: true
---

# Operator Search Rework — Frame

## Source

> Next thing I wanna pick up is the search right now the search isnt very
> initative or dynamic. I want to rework it so operators can easily search by
> id/driver/exec and other key filters.

---

## Problem

The dashboard search is shallow and locally scoped:

- **Client-side only, scoped to the loaded view.** The server fetches one day
  (or one state via a saved view) and the search box filters that in-memory set
  with `.includes()`. An operator cannot find a booking that isn't already on
  screen — e.g. "pull up BKNG-00042" from any day.
- **The fields operators actually search by aren't matched.** Today it matches
  the raw UUID, passenger name, pickup/dropoff address, account code, case code,
  and vehicle string. It does **not** match the human booking reference
  (`BKNG-00001`), the **driver** name, or the **exec** phone/company.
- **No structured filters.** There's a free-text box plus day/assignee/state
  view toggles, but no way to combine "driver = Marcus" + "this week" or
  "state = unassigned" + a name in one motion.

Net effect: operators can't quickly answer "where's this booking / this exec /
this driver's jobs?" — the daily-livelihood lookups.

## Outcome

An operator can, from anywhere in the console, quickly find what they need by:

- Booking reference / id, driver, or exec — the identities they hold in their
  head when a phone rings.
- Combining a search term with a few key filters (the "other key filters").
- Getting results that feel immediate and global, not limited to today's board.

Success = the common "find it now" lookups take one obvious action and return
the right booking regardless of date or current view.
