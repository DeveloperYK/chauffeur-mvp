-- Operator ownership (Jira-style) + drop booking-time vehicle preference / booker name.
ALTER TABLE "bookings" ADD COLUMN "created_by_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "assigned_operator_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_operator_id_operators_id_fk" FOREIGN KEY ("created_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_operator_id_operators_id_fk" FOREIGN KEY ("assigned_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_assigned_operator_idx" ON "bookings" USING btree ("assigned_operator_id");--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "booker_name";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "car_type_preference";
