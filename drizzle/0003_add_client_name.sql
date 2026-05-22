-- Add client name field to bookings.
-- Make passenger_last_name nullable (not required for MVP).
ALTER TABLE "bookings" ADD COLUMN "client_name" text;--> statement-breakpoint
UPDATE "bookings" SET "client_name" = COALESCE("account_code", 'Unknown') WHERE "client_name" IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "client_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "passenger_last_name" DROP NOT NULL;
