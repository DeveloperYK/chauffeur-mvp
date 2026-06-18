-- Exec messaging visibility (V1). Until now every automated exec message went
-- out through NotificationPort.sendSms and the result was thrown away, so a
-- failed send was completely silent. This persists every attempt — one row per
-- message, success or failure — and adds a cached per-booking roll-up so the
-- board can flag a problem without aggregating the log on every tile render.
-- `channel` is recorded per row (sms today; email arrives in a later slice).
-- See docs/shaping/exec-messages.
CREATE TYPE "notification_channel" AS ENUM('sms', 'email');
--> statement-breakpoint
CREATE TYPE "notification_kind" AS ENUM('assigned', 'en_route');
--> statement-breakpoint
CREATE TYPE "notification_status" AS ENUM('sent', 'delivered', 'failed', 'bounced', 'complained', 'superseded');
--> statement-breakpoint
CREATE TYPE "exec_notification_status" AS ENUM('none', 'pending', 'ok', 'failed');
--> statement-breakpoint
CREATE TABLE "exec_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"to" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "notification_status" NOT NULL,
	"provider_message_id" text,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exec_notifications" ADD CONSTRAINT "exec_notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "exec_notifications_booking_created_idx" ON "exec_notifications" USING btree ("booking_id","created_at");
--> statement-breakpoint
CREATE INDEX "exec_notifications_failed_idx" ON "exec_notifications" USING btree ("booking_id") WHERE "status" in ('failed', 'bounced', 'complained');
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "exec_notification_status" "exec_notification_status" DEFAULT 'none' NOT NULL;
