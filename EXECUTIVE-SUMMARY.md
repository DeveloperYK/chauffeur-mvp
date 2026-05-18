# Executive Summary — Chauffeur Dispatch Platform MVP

## The problem

The client runs a chauffeur company doing approximately **£70k/week** under an exclusivity partnership with a major consultancy. The operation is held together by:

- **Phone bookings** from consultancy PAs to in-house operators.
- **A shared spreadsheet** that operators update by hand for every booking.
- **Manual driver hand-off** — operators phone or WhatsApp employee drivers one by one until someone accepts, then type the assignment back into the spreadsheet.
- **A WhatsApp group of backfill subcontractors** as fallback (rare).
- **Manual monthly invoicing** off the spreadsheet.

It works, but **operators are the throughput limit**, and the spreadsheet has no live status — so issues like a no-show driver are discovered only when the client complains.

## The principle

The client explicitly said the **PA and executive experience must not change** at MVP. Modernise the operator's tooling, not the client's relationship with the service.

So this MVP:

- **Does not give PAs a portal.** They keep phoning the operator. Same call, same questions.
- **Does not change what the executive receives.** Same two messages (booking confirmed, driver en route) — just sent automatically by the system instead of typed by an operator.
- **Does not auto-dispatch.** The operator still chooses which driver to offer each job to.
- **Does not touch backfill subcontractors.** The existing WhatsApp group continues — the client confirmed this is rare.

What it does change is the **operator's workplace** and the **driver hand-off mechanism**.

## The solution

| Today | After MVP |
|---|---|
| Operator works from a spreadsheet | Operator works from a live ticket dashboard — seven-column board |
| Phones drivers one by one to find an acceptor | Picks a driver, clicks "Generate link", forwards via WhatsApp one-tap |
| Driver replies verbally or in chat; operator types into spreadsheet | Driver taps Accept on a web link; system captures everything |
| Operator types exec confirmation SMS by hand | System fires SMS automatically on assignment and again at T-1h |
| Trip completion details captured verbally / by chat | Driver receives a second link, fills carpark/waiting/drop-off in a web form; operator reviews and approves |
| Spreadsheet is the source of truth | Database is source of truth; **a Google Sheet mirrors every change** as a permanent safety net |
| No visibility of stuck or stalled bookings | Built-in "Needs Action" lane catches every issue |

### The four user-facing pieces

1. **Operator Dashboard** (web, four logins, one per operator) — booking entry, ticket board, driver roster, audit history.
2. **Driver web link — accept/decline** (no login, WhatsApp-distributed) — the operator forwards it; driver taps accept; system captures who and what car.
3. **Driver web link — completion form** (no login, WhatsApp-distributed) — sent after the trip; driver submits car park, waiting time, drop-off time.
4. **Google Sheets live mirror** — every state change replicates into a sheet that matches the current spreadsheet's column layout, so the business can fall back to the old workflow if our system is ever unavailable.

### How a driver experiences the change

- Receive a WhatsApp message from the operator with a link.
- Tap link → see job card → tap Accept.
- Drive the trip (no app interaction needed).
- After the trip, receive a second WhatsApp link.
- Tap link → fill three fields (car park, waiting time, drop-off time) → submit.

No download, no login, no signup, no account. Designed for the lowest-effort path from "operator sent me a job" to "job done".

## Why this matters commercially

- **Removes the spreadsheet as the bottleneck.** Operators can run more jobs per shift because each one is a few clicks rather than a sequence of phone calls and typed updates.
- **Removes the WhatsApp scramble for employee drivers.** Hand-off is structured, audited, and survives a busy night.
- **Surfaces problems before the client notices them.** Tickets that don't get accepted, drivers who don't complete, drivers who don't submit forms — all land in a "Needs Action" lane.
- **De-risks operator adoption.** The Google Sheets mirror means at no point does the business depend on our system working — if the dashboard breaks, they open the sheet and carry on.
- **Builds the data foundation** for v2: auto-dispatch, billing automation, and possibly a PA portal once we've earned the right.

## MVP scope (in)

- One client account (the consultancy), many PAs phoning in, many executives.
- Phone-only intake (operator types into the dashboard).
- Employee drivers only, organised by tier (Premium / Ordinary). Roster is operator-maintained.
- Manual operator-led dispatch via signed WhatsApp links.
- Clock-driven state transitions: assignment → in progress at T-1h → completion form due at T+expected_end.
- Two automatic SMS to the exec — booking confirmed, driver en route.
- Two driver web pages — accept/decline, completion form.
- Live Google Sheets mirror of every booking and state change.
- Audit log of every action.

## MVP scope (out — deferred to v2)

- PA self-serve portal.
- Native driver app, GPS tracking, live tracking link for executives.
- Auto-cascade dispatch and scored driver shortlisting.
- Backfill subcontractor management in the app.
- Per-executive records / address book.
- Automated billing, invoicing, payment processing.
- Recurring bookings, multi-leg trips.
- Multi-tenant (other corporate clients).

## Transition strategy — "no sudden changes"

The client said they cannot transition all at once. Two principles:

1. **The PA and executive experience never changes** during MVP. Cutover is invisible to them.
2. **The Google Sheets mirror runs from day one** and stays live for the whole MVP — and beyond if the client wants. Operators can fall back to the spreadsheet workflow at any time.

Rollout phases:

- **Phase 0 — pilot (2 weeks)** One operator uses the dashboard on a subset of jobs. The other three keep working the spreadsheet. Mirror is live so the spreadsheet-side operators see the pilot operator's tickets in the sheet.
- **Phase 1 — full cutover (2 weeks)** All four operators move to the dashboard. Sheet stays as backup.
- **Phase 2 — observation (4 weeks)** No new features. Bug fixes, ergonomics, training. Measure where operators still reach for the sheet vs. the dashboard.

At no point are operators forced onto the dashboard if it's failing them. The cost of failure is bounded.

## Volume assumptions

Sized for **50–100 bookings/day** across **four operators**. This drives:

- Each operator handling ~12–25 bookings per shift.
- A single Postgres database and a single backend service — well within capacity.
- The dashboard's "Needs Action" lane catching the handful of exceptions per day.

The same architecture handles 200–300/day without rewriting. The lever to push past that without growing the operator team is **auto-dispatch** — v2.

## Risks & dependencies

| Risk | Mitigation |
|---|---|
| Operators don't trust the dashboard early on | Sheet mirror stays live; phased rollout; pilot with one operator first |
| Drivers ignore links instead of declining | 24-hour no-accept auto-flag; operator can re-offer at any time |
| Driver's WhatsApp number changes | Editable on the roster in seconds |
| Driver doesn't fill the completion form | "Awaiting Driver Form" lane on the board; operator chases |
| Sheets API hiccups cause drift between DB and mirror | Mirror writes are logged; resync job rebuilds the sheet from the DB |
| Client requests billing or PA portal mid-build | Documented as out-of-scope; defended in writing before kickoff |

## Timeline (indicative)

Subject to confirmation after the open questions close:

- **Partner sign-off:** 1 week (this document + Q&A).
- **Client conversation on open questions:** 1–2 weeks.
- **Build:** estimate produced once questions are closed.
- **Phase 0 pilot:** 2 weeks after build.
- **Phase 1 cutover:** 2 weeks after pilot.
- **Phase 2 observation:** 4 weeks after cutover.

## What we need from the client to proceed

See [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md). The top three for the first conversation:

1. **Existing spreadsheet hosting** — where does the current `JJ DATA` workbook live (local Excel, OneDrive, SharePoint, Google Drive)? Drives whether we import history at cutover.
2. **UK regulatory scope** — London PHV, TfL, national? Drives driver-roster fields.
3. **Per-tier driver pool sizes** — sanity check that operator-led dispatch is workable at peak.

---

*Full design and diagrams: see [`DESIGN.md`](./DESIGN.md) in this folder.*
