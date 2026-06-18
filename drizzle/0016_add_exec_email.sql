-- Exec email address for the email notification channel (exec-messages V2).
-- Nullable: SMS-mode bookings don't carry one; the booking form collects it
-- only when email is the active channel. An email-mode booking missing this is
-- surfaced as a loud failed exec notification, never a silent drop.
ALTER TABLE "bookings" ADD COLUMN "exec_email" text;
