-- Backfill (subcontractor) driver support. When no internal driver is available
-- the operator hands the booking to a backfill driver from the WhatsApp group.
-- The booking runs through its normal states with assigned_driver_id null and
-- these free-text fields recording who covered it. The car they bring reuses
-- car_for_this_job; only name + phone need dedicated columns. See
-- docs/shaping/backfill-drivers.
ALTER TABLE "bookings" ADD COLUMN "is_backfill" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "backfill_driver_name" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "backfill_driver_phone" text;
