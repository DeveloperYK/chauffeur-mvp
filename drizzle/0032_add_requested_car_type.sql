-- Optional car type requested by the PA at booking time (free text, e.g. MPV, Luxury).
-- Nullable, no default: existing rows carry no request. Rollback: DROP COLUMN.
ALTER TABLE "bookings" ADD COLUMN "requested_car_type" text;
