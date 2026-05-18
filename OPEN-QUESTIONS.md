# Open Questions for the Client

These need answers before build kicks off. None of them block partner sign-off on this design — they shape the build phase. Grouped by topic; each notes what design decision it unblocks.

## Spreadsheet & data

1. **Where does the current `JJ DATA` workbook live?**
   *Local Excel file, OneDrive, SharePoint, Google Drive?*
   Unblocks: whether the Google Sheets mirror can pull in historical bookings at cutover, and how. The mirror itself lives in a new Google Sheet — this question is about migrating prior data.

2. **How many historical bookings would you like visible in the new system?**
   *All-time, last 12 months, last 3 months, none?*
   Unblocks: data import scope and effort.

## Drivers

3. **Per-tier driver pool size today — Premium and Ordinary?**
   *Roughly how many active drivers in each tier?*
   Unblocks: sanity check that operator-led dispatch is workable. With small pools the operator's choice list is short, which is fine; with large pools we'll want to add filtering and sort hints.

4. **Are car-swap-per-job situations common, or rare?**
   *Drivers using a different car than their default — sometimes, often, almost never?*
   Unblocks: how prominent the "change car before accept" affordance is on the driver link page.

5. **Where does the current driver list live?**
   *In the operator's head, in the spreadsheet's reference list, in a separate document?*
   Unblocks: initial seeding of the dashboard's driver roster.

6. **Are driver WhatsApp numbers documented anywhere today?**
   *Or only in the operators' personal phones?*
   Unblocks: same as above — initial roster seeding.

## Bookings

7. **Beyond pickup and drop-off, what fields do operators routinely capture today?**
   *Flight number, terminal, gate, child seat, vehicle preference, special instructions?*
   Unblocks: the booking form fields on the dashboard.

8. **Are there multiple billing entities within the consultancy?**
   *Different cost centres, offices, subsidiaries each invoiced separately?*
   Unblocks: account / cost-centre fields on the booking, even though billing itself is out of MVP.

9. **What is the cancellation policy?**
   *Charges for late cancellation (under 24h, on the day, no-show)? Currently logged anywhere?*
   Unblocks: cancellation flow on the dashboard, and audit fields for future billing.

## Executive notifications

10. **Exactly what do current confirmation and "driver en route" messages say?**
    *We want to replicate the wording so executives notice no change.*
    Unblocks: SMS templates.

11. **Are there any executives who have asked not to receive SMS?**
    *Some senior people prefer "the driver will call you" — we may need a "no SMS" flag per booking.*
    Unblocks: per-booking notification toggle.

## Regulatory & compliance

12. **What is the regulatory scope — London PHV, TfL, regional licensing, national?**
    *Drives onboarding data fields (badge number, vehicle plate type, etc.).*
    Unblocks: driver-roster schema and any compliance reports.

13. **Is there a written SLA in the consultancy partnership contract?**
    *E.g. "driver must arrive within X minutes of pickup time."*
    Unblocks: whether the dashboard's "Needs Action" thresholds match a contractual obligation.

14. **GDPR / data residency requirements?**
    *Where can the database live? UK-only, EU-allowed? Any specific data-handling clauses in the consultancy contract?*
    Unblocks: hosting region and vendor selection (SMS provider, etc.). Google Workspace already implies EU/UK availability.

## Pricing & billing (out of MVP, but informs data model)

15. **How is pricing structured today — flat rate, time-based, distance-based, hybrid?**
    *Even though billing stays manual at MVP, the booking record should capture enough to invoice from later.*
    Unblocks: which fields the operator types into the booking form.

16. **What does month-end invoicing look like today?**
    *Spreadsheet export, accounting software, hand-written?*
    Unblocks: v2 billing scope planning.

## Timeline & commercial

17. **Target go-live date?**
    *Drives phase durations and resourcing.*

18. **Who at the client signs off the design?**
    *We want one decision-maker in the room when we walk through the design.*

---

## How to use this document

- Send to the client in advance of the working session so they can gather answers (some need looking up).
- Walk through it live and capture decisions inline.
- Any "unknown" answers become assumptions in the design — written explicitly, agreed in writing.

## Already answered (folded into the design)

The following were earlier open questions and have been decided. Listed here so the partner can see what we've already locked in:

- **Backup system:** continuous live mirror to **Google Sheets** in the client's Google Workspace tenancy.
- **PA / secretary intake:** stays phone-only for MVP. No portal.
- **Driver channel:** WhatsApp link only. No app, no GPS.
- **Dispatch model:** operator picks driver, system mints signed link, operator forwards via WhatsApp. No auto-cascade.
- **Driver roster onboarding:** manual, by any operator from the dashboard.
- **Operators:** four today, each gets a login at deployment.
- **Backfill subcontractors:** out of MVP. They keep using the existing WhatsApp group.
- **No-accept auto-flag window:** default **24 hours** (configurable). Bookings are placed ≥24h ahead.
- **Exec mobile number:** mandatory field on every booking, captured by the operator on the call. No per-exec record stored.
- **Exec notifications:** two automatic SMS — booking confirmed (on Assigned), driver en route (on In Progress).
- **Trip completion:** clock auto-moves to "Awaiting Driver Form" at T+expected_end; driver receives a 2nd link; operator approves to move to Completed.
