-- Driver vehicle number plate (registration), shown to the executive so they
-- can identify the car kerbside (exposed in the exec confirmation/en-route
-- email alongside colour + model). Nullable: optional on the driver profile and
-- absent on existing rows.
ALTER TABLE "drivers" ADD COLUMN "number_plate" text;
