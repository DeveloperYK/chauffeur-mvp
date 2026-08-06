CREATE TYPE "public"."mirror_status" AS ENUM('none', 'ok', 'failed');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "mirror_status" "mirror_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "mirrored_at" timestamp with time zone;
