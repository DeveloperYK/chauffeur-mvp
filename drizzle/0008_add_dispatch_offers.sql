-- Dispatch offers: one row per minted dispatch link (one driver, one booking).
-- Fanning a job out to several drivers creates several `open` offers; the first
-- to accept turns their row `accepted` and lapses the rest. Powers the console's
-- "Offered to N · awaiting" visibility.
CREATE TYPE "offer_status" AS ENUM('open', 'accepted', 'lapsed');
--> statement-breakpoint
CREATE TABLE "dispatch_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"jti" text NOT NULL,
	"status" "offer_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dispatch_offers" ADD CONSTRAINT "dispatch_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dispatch_offers_booking_idx" ON "dispatch_offers" USING btree ("booking_id");
--> statement-breakpoint
CREATE INDEX "dispatch_offers_booking_status_idx" ON "dispatch_offers" USING btree ("booking_id","status");
