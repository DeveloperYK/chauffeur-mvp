-- "Mark as handled" for the three operator-sent exec emails (confirmation,
-- driver details, booking update). The operator told the exec another way or
-- the email is no longer worth sending, so the "email due" flag is cleared
-- without pretending an email went out. Null = not waived. Read only inside
-- the already-filtered "Send exec emails" candidate set, so no index.
--
-- Rollback:
--   ALTER TABLE "bookings" DROP COLUMN "confirmation_email_waived_at";
--   ALTER TABLE "bookings" DROP COLUMN "driver_details_email_waived_at";
--   ALTER TABLE "bookings" DROP COLUMN "change_update_email_waived_at";

ALTER TABLE "bookings" ADD COLUMN "confirmation_email_waived_at" timestamp with time zone;
ALTER TABLE "bookings" ADD COLUMN "driver_details_email_waived_at" timestamp with time zone;
ALTER TABLE "bookings" ADD COLUMN "change_update_email_waived_at" timestamp with time zone;
