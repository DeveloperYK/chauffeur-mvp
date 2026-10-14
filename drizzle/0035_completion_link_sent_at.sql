-- When the operator last generated (and sent) the driver's completion-form
-- link for this booking. Null while the booking is awaiting_driver_form means
-- "the form has not been sent yet" — the rail's "Send completion form" view.
-- Cleared when a submitted form is rejected, so the operator is prompted to
-- send it again. Filtered only inside the (small, indexed) awaiting_driver_form
-- set, so no index of its own.
--
-- Rollback: ALTER TABLE "bookings" DROP COLUMN "completion_link_sent_at";

ALTER TABLE "bookings" ADD COLUMN "completion_link_sent_at" timestamp with time zone;
