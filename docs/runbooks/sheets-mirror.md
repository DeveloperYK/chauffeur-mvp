# Runbook — Google Sheets backup mirror

The dispatch platform mirrors every booking into a Google Sheet in real time, so
the operators always have a live, external, **revertible backup** of all jobs. If
the app or database ever breaks, the sheet is a faithful copy they can work from
and re-key into a fresh system.

- **What is mirrored:** one row per booking, keyed by **Job #** (column A). Every
  state change (create, dispatch, completion, cancel, edit, backfill) updates the
  same row in place — no duplicate rows.
- **Layout:** the 27 columns A–AA of the **"Main Data"** table in `JJ .xlsx`
  (`src/server/ports/spreadsheet-mirror.ts` is the single source of truth for the
  column order). Billing-output columns (Driver Cost, Net Due, VAT, Total,
  Sub-contractor Cost) are intentionally left blank for the operators to fill.
- **Failure mode:** mirroring is fire-and-forget. If Google is unreachable the
  booking still succeeds and the failure is logged; it is never user-visible.

When `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_JSON` are unset the
app uses an in-memory fake (dev/test), so nothing leaves the machine.

---

## One-time setup

### 1. Create (or reuse) a Google Cloud project + service account

A Cloud project already exists for Google Places (see the Places setup notes). You
can reuse it.

1. Google Cloud Console → **APIs & Services → Enable APIs** → enable **Google
   Sheets API**.
2. **IAM & Admin → Service Accounts → Create service account**
   - Name: `chauffeur-sheets-mirror`
   - No project roles needed (access is granted per-sheet, below).
3. On the new service account → **Keys → Add key → Create new key → JSON**.
   Download the JSON file. **Treat it as a secret** — never commit it.

### 2. Create the spreadsheet

1. Create a new Google Sheet (e.g. "Groundwork — Bookings Backup").
2. Rename the first tab to **`Main Data`** (must match exactly; or override via the
   `sheetName` config). The app writes the header row on first use, so the tab can
   start empty.
3. Copy the spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<THIS_IS_THE_ID>/edit`.

### 3. Share the sheet

- Share the spreadsheet with the service account's `client_email`
  (`chauffeur-sheets-mirror@<project>.iam.gserviceaccount.com`) as **Editor** —
  otherwise writes return `http_403`.
- Share it with the four operators (view or edit) — this **is** the hosted,
  outside-the-system backup they fall back to.

### 4. Set the environment variables

`GOOGLE_SERVICE_ACCOUNT_JSON` must be the **entire** JSON file on a single line.

Local (`.env`):

```bash
GOOGLE_SHEETS_SPREADSHEET_ID=<spreadsheet id>
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"…", …}
```

Vercel (Production, and Preview if you want it there too):

- Project → **Settings → Environment Variables** → add both. Paste the JSON as the
  value; Vercel stores it verbatim.
- Redeploy so the running functions pick up the new env.

### 5. Verify

- Create a test booking from the dashboard → a new row appears on `Main Data`
  within a second or two, with the header row above it.
- Move the booking through its lifecycle → the **same** row updates in place.
- If nothing appears, check the function logs for `sheets ... non-2xx`
  (`http_403` = sheet not shared with the service account; `http_404` = wrong
  spreadsheet ID or tab name).

---

## Notes

- The header row and one-row-per-Job# upsert are handled automatically by
  `GoogleSheetsSpreadsheetMirror`; no manual header setup is required.
- To rotate the key: create a new JSON key, update the env var, redeploy, then
  delete the old key in the Cloud Console.
- The column layout lives in `SHEET_HEADERS` / `rowFromBooking`. If the JJ workbook
  changes, update those (and their tests) — the sheet follows the code.
