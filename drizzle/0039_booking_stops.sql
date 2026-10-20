-- Multi-stop journeys (docs/shaping/multi-stop, ADR 0030). A transfer may
-- carry ordered intermediate stops between its pickup and destination, each
-- with a planned wait (scheduling only) and, after completion, the actual
-- arrival/departure the driver recorded. Pickup and destination stay on
-- bookings; hourly bookings carry no stops (enforced in the service).
--
-- Rollback:
--   DROP TABLE "booking_stops";

CREATE TABLE "booking_stops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "address" text NOT NULL,
  "place_id" text,
  "planned_wait_minutes" integer NOT NULL DEFAULT 0,
  "arrived_at" timestamp with time zone,
  "departed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "booking_stops_seq_positive" CHECK ("seq" >= 1),
  CONSTRAINT "booking_stops_wait_range" CHECK ("planned_wait_minutes" >= 0 AND "planned_wait_minutes" <= 720)
);--> statement-breakpoint
CREATE UNIQUE INDEX "booking_stops_booking_seq_idx" ON "booking_stops" ("booking_id", "seq");
