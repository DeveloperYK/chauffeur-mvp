-- Split booking notes into driver-facing and operator-only. The existing
-- `notes` column stays driver-facing (it is shown to the driver on the dispatch
-- link page). This adds a private `operator_notes` column for information the
-- operators want to record but never surface to the driver — e.g. a difficult
-- client, a billing quirk. It is never rendered on the public driver link page.
ALTER TABLE "bookings" ADD COLUMN "operator_notes" text;
