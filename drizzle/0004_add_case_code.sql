-- Add "Case code" to bookings: the expense code the customer's company uses
-- to cover the cost. Maps to the legacy JJ sheet column D ("Case Code").
-- Nullable: bookings created before this field exist without one.
ALTER TABLE "bookings" ADD COLUMN "case_code" text;
