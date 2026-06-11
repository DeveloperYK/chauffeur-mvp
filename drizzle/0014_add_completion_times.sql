-- Completion form now captures three wall-clock times instead of a single
-- drop-off plus a manually typed waiting figure. `arrival_at` is when the driver
-- reached the pickup; `passenger_on_board_at` is when the journey started.
-- `dropoff_at` (already present) becomes the completion/trip-end time, and
-- `waiting_time_minutes` (already present) is now derived as
-- (passenger_on_board_at − arrival_at) so the existing waiting charge is
-- unchanged. Both new columns are nullable: historical bookings never had them.
ALTER TABLE "bookings" ADD COLUMN "arrival_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "passenger_on_board_at" timestamp with time zone;
