CREATE TYPE "public"."actor_type" AS ENUM('operator', 'system', 'driver');--> statement-breakpoint
CREATE TYPE "public"."booking_state" AS ENUM('unassigned', 'assigned', 'in_progress', 'awaiting_driver_form', 'awaiting_operator_review', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."car_type" AS ENUM('ex', 's_class', 'mpv', 'mini_bus');--> statement-breakpoint
CREATE TYPE "public"."driver_tier" AS ENUM('premium', 'ordinary');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state" "booking_state" DEFAULT 'unassigned' NOT NULL,
	"pickup_at" timestamp with time zone NOT NULL,
	"expected_duration_minutes" integer NOT NULL,
	"pickup_address" text NOT NULL,
	"dropoff_address" text NOT NULL,
	"passenger_first_name" text NOT NULL,
	"passenger_last_name" text NOT NULL,
	"exec_mobile" text NOT NULL,
	"booker_name" text NOT NULL,
	"account_code" text NOT NULL,
	"car_type_preference" "car_type" NOT NULL,
	"contract_price_pence" integer NOT NULL,
	"notes" text,
	"assigned_driver_id" uuid,
	"car_for_this_job" "car_type",
	"assigned_at" timestamp with time zone,
	"car_park_pence" integer,
	"waiting_time_minutes" integer,
	"dropoff_at" timestamp with time zone,
	"completion_submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_operator_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_operator_id" uuid,
	"cancellation_reason" text,
	"flagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumed_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tier" "driver_tier" NOT NULL,
	"default_car_type" "car_type" NOT NULL,
	"whatsapp_number" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_assigned_driver_id_drivers_id_fk" FOREIGN KEY ("assigned_driver_id") REFERENCES "public"."drivers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_approved_by_operator_id_operators_id_fk" FOREIGN KEY ("approved_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_operator_id_operators_id_fk" FOREIGN KEY ("cancelled_by_operator_id") REFERENCES "public"."operators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_operators_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bookings_state_idx" ON "bookings" USING btree ("state");--> statement-breakpoint
CREATE INDEX "bookings_pickup_at_idx" ON "bookings" USING btree ("pickup_at");--> statement-breakpoint
CREATE INDEX "bookings_state_pickup_idx" ON "bookings" USING btree ("state","pickup_at");--> statement-breakpoint
CREATE INDEX "bookings_assigned_driver_idx" ON "bookings" USING btree ("assigned_driver_id");--> statement-breakpoint
CREATE INDEX "drivers_tier_active_idx" ON "drivers" USING btree ("tier","active");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_whatsapp_idx" ON "drivers" USING btree ("whatsapp_number");--> statement-breakpoint
CREATE UNIQUE INDEX "operators_email_idx" ON "operators" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");