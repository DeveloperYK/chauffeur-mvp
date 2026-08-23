-- Optional structured flight/train reference for airport / station pickups.
-- travel_mode: 'flight' | 'train'; travel_ref: normalized IATA designator for
-- flights (e.g. BA268) or a short arrival description for trains. Both null
-- when the pickup involves neither.
ALTER TABLE "bookings" ADD COLUMN "travel_mode" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "travel_ref" text;
