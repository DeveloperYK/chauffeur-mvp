-- Booking service type: point-to-point `transfer` vs `hourly` as-directed hire.
-- Existing rows default to `transfer` (the only shape until now). `distance_meters`
-- holds the route distance for transfers (null for hourly). `dropoff_address`
-- becomes nullable because hourly bookings have no fixed destination.
CREATE TYPE "public"."service_type" AS ENUM('transfer', 'hourly');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "service_type" "public"."service_type" DEFAULT 'transfer' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "distance_meters" integer;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "dropoff_address" DROP NOT NULL;
