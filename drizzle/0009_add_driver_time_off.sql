-- Planned driver unavailability: an inclusive whole-day date range during
-- which the driver should not be offered as a dispatch candidate. Distinct
-- from `drivers.active` (global on/off — "no longer works for us").
--
-- Decisions baked in (docs/shaping/driver-availability/shaping.md):
--   * whole days only — no half-days, no time-of-day precision
--   * no recurring patterns — one-off date ranges only
--   * no reason field — captured out of band
--
-- Cascade on driver delete: if a driver is removed, their time-off rows
-- (purely operational scheduling data) go too. `created_by_operator_id`
-- is nullable + SET NULL on operator delete so we never block operator
-- offboarding for an audit trace (the `audit_events` table is the
-- authoritative actor record).
CREATE TABLE "driver_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL REFERENCES "drivers"("id") ON DELETE CASCADE,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_by_operator_id" uuid REFERENCES "operators"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_time_off_range_ck" CHECK ("ends_on" >= "starts_on")
);

-- Hot path: "is driver X off on date D" and "list time-off for driver X
-- between F and T" — both filter by driver_id then range.
CREATE INDEX "driver_time_off_driver_dates_idx"
  ON "driver_time_off" ("driver_id", "starts_on", "ends_on");
