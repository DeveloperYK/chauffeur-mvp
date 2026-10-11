---
shaping: true
---

# Mobile shell — Shaping

## Source

> we need to fix/improve the mobile view of the application right now its really poor it might require a redesign the main thing is sometimes an operator is out and theres an urgent message to add a booking so they need to do it on the spot they dont really need access to everything on the app but the ability to handle a booking is a must in a clear way we should probably rework the mobile view from scratch

Decisions taken with the user (2026-10-11): a **dedicated mobile shell for the core flow** (not a fully responsive console, not create-only). Must work from the phone: create, dispatch / offer to driver, edit, cancel (with undo), approve completed jobs.

---

## Problem

The console is a desk tool: a 232 px rail, a seven-column board or a 700 px-wide list table, a 1,500-line detail panel and six modals. At phone width it is squeezed through one `@media (max-width: 768px)` block — the rail becomes a scroll strip, the table scrolls sideways, the panel is forced to `100vw`. It renders, but an operator who is out and has to add or fix a booking *now* has to pan a table, find a 13 px row, and work through a panel designed for a 1,400 px monitor.

What the operator on a phone actually needs is small: see what is booked and what is broken, add a booking, get a driver on it, fix details, cancel, approve. Calendar, roster, invoicing, exec emails, backfill paperwork and the simulator are desk work.

## Outcome

- A phone opening `/dashboard` lands on `/m`: one column, big tap targets, one obvious action per screen.
- **Day list** — today by default, step a day either way; "Needs you" first (no driver / review due / driver not told), then scheduled, then done. A cross-day **Needs attention** list one tap away.
- **New booking** — the full create form as a full-screen sheet; lands on the booking's day with a toast.
- **Booking screen** — pickup time, passenger, account, a flag if it needs attention, then the actions for its state (the first is the primary button): find a driver / message or call the driver / unassign / reassign / approve / reject / edit / cancel. Trip, driver, people and money facts below. A link to the full console for the desk-only tools.
- **Dispatch, edit, cancel** are the console's own modals rendered as full-screen sheets, so behaviour (offers, busy flags, postcode rule, undo window) is identical on both surfaces.
- The full console stays one tap away (`Full console`) and that choice is remembered; the rail offers `Mobile view` back on small screens.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | An operator on a phone can **create a booking** with the same validation as the desk | Must-have |
| R1 | …can **dispatch**: offer to one or more drivers (WhatsApp links open the app), or assign confirmed-by-phone | Must-have |
| R2 | …can **edit** any editable booking | Must-have |
| R3 | …can **cancel** with the 60 s undo | Must-have |
| R4 | …can **approve / reject** a completed job awaiting review | Must-have |
| R5 | …can see **today's bookings** and **what needs attention** (across days) at a glance | Must-have |
| R6 | Phones are routed to the shell automatically; the full console remains reachable and the choice sticks | Must-have |
| R7 | No new server actions, services or schema: the shell is a second client over the existing use-cases | Constraint |
| R8 | Desk-only tools (calendar, roster, invoicing, exec emails, backfill, completion link, history, simulator) are **not** rebuilt for mobile; the shell links to the full console for them | Scope |

---

## Shape: dedicated route group `/m` + middleware routing

| Part | Where | Notes |
|---|---|---|
| Routing decision | `src/lib/console-mode.ts`, `src/middleware.ts` | Pure `resolveConsoleRoute` (unit-tested) + `isMobileClient` (client hint, else UA; iPad = desk). `?console=desktop\|mobile` persists in a 1-year cookie. Board deep links map across (`?booking=` → `/m/b/:id`, `?new=1` → `/m/new`, `?date=` kept). |
| Read models | `src/server/services/console-view.ts` | `toConsoleBooking` (moved out of the board page — one serializer for both surfaces), `loadDayView`, `loadAttentionView`, `loadBookingView` (booking + roster + busy windows for the dispatch sheet). |
| Presentation rules | `src/lib/mobile-sections.ts`, `src/lib/mobile-actions.ts` | Pure: day sectioning + attention reason; per-state action list with exactly one primary. |
| Screens | `src/app/(mobile)/m/{page,new/page,b/[id]/page}.tsx`, `src/components/mobile/*` | Server pages load, client screens act. Own stylesheet `src/app/mobile.css`; console tokens reused. |
| Sheets | `components/console/{new-booking,dispatch,edit-booking,cancel}-modal.tsx` | Unchanged except `DispatchModal mobile` → `wa.me` links. CSS in the shell makes `.modal__card` full-screen. |
| Tests | `tests/unit/lib/{console-mode,mobile-sections,mobile-actions}.test.ts`, `tests/unit/middleware.test.ts`, `tests/integration/services/console-view.test.ts`, `tests/e2e/mobile.spec.ts` (iPhone 13 project) | |

### Rejected

- **Make the whole console responsive.** Every page and the 1,500-line panel would need a phone layout, and a seven-column board is never going to be good at 390 px. Larger, worse.
- **Client-side `matchMedia` switch.** Flash of the wrong layout on every load and both trees in the bundle. The request already tells us it is a phone.
- **Separate mobile forms.** Duplicating the create/edit forms means duplicating the postcode rule, route estimate, price handling, car-type quick-picks… The modals are already phone-capable; they only needed to be full-screen.
