-- Replace the driver "tier" (premium/ordinary) with a 4-value vehicle class
-- (Executive, Luxury, MPV, Coach). The car now lives on the driver profile,
-- not the job: rename drivers.default_car_type -> drivers.car, add a colour,
-- and drop the per-job bookings.car_for_this_job (drivers can no longer change
-- the car when accepting a job).
--
-- Existing drivers are all set to 'executive'; operators re-classify the few
-- that should be Luxury/MPV/Coach by hand afterward.

-- New vehicle-class enum.
CREATE TYPE "public"."vehicle_class" AS ENUM('executive', 'luxury', 'mpv', 'coach');

-- Add the new column, backfilling every existing driver to 'executive'.
ALTER TABLE "drivers" ADD COLUMN "vehicle_class" "public"."vehicle_class" NOT NULL DEFAULT 'executive';
-- Inserts must now supply the class explicitly (matches the old tier column,
-- which had no default).
ALTER TABLE "drivers" ALTER COLUMN "vehicle_class" DROP DEFAULT;

-- Drop the old tier column, its index, and the enum type.
DROP INDEX IF EXISTS "drivers_tier_active_idx";
ALTER TABLE "drivers" DROP COLUMN "tier";
DROP TYPE "public"."driver_tier";

-- Index the new class for the drivers board filter/sort.
CREATE INDEX "drivers_vehicle_class_active_idx" ON "drivers" USING btree ("vehicle_class", "active");

-- The car moves to the driver profile: keep the existing make/model (rename),
-- add a colour (existing rows get '' until an operator fills it in).
ALTER TABLE "drivers" RENAME COLUMN "default_car_type" TO "car";
ALTER TABLE "drivers" ADD COLUMN "car_colour" text NOT NULL DEFAULT '';
ALTER TABLE "drivers" ALTER COLUMN "car_colour" DROP DEFAULT;

-- The per-job car is gone for internal drivers (the car is now fixed to the
-- assigned driver profile). The column survives only to record a backfill
-- subcontractor's car, so rename it and clear it for non-backfill rows.
ALTER TABLE "bookings" RENAME COLUMN "car_for_this_job" TO "backfill_car";
UPDATE "bookings" SET "backfill_car" = NULL WHERE "is_backfill" = false;
