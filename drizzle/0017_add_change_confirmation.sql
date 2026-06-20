-- Mid-flight change confirmation (docs/shaping/mid-flight-changes).
-- When a driver-facing field is edited after dispatch (assigned/in_progress),
-- the booking is flagged so the operator can confirm the assigned driver knows
-- the new plan — either by attesting a phone call (operator_attested) or by the
-- driver tapping a confirm link (driver_self). Advisory; orthogonal to the
-- booking lifecycle `state`.
CREATE TYPE "public"."change_confirmation_status" AS ENUM('none', 'pending', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."confirmation_method" AS ENUM('driver_self', 'operator_attested');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "change_confirmation_status" "change_confirmation_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "change_pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "change_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "change_confirmed_method" "confirmation_method";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "change_confirmed_by_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_change_confirmed_by_operator_id_operators_id_fk" FOREIGN KEY ("change_confirmed_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;
