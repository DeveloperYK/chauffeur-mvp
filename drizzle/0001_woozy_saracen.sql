ALTER TABLE "bookings" ALTER COLUMN "car_type_preference" SET DATA TYPE text USING "car_type_preference"::text;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "car_for_this_job" SET DATA TYPE text USING "car_for_this_job"::text;--> statement-breakpoint
ALTER TABLE "drivers" ALTER COLUMN "default_car_type" SET DATA TYPE text USING "default_car_type"::text;--> statement-breakpoint
DROP TYPE "public"."car_type";
