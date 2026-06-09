-- Backfill (subcontractor) driver pay. Internal drivers are salaried and not
-- paid per booking; backfill drivers are. This records what the backfill driver
-- is paid for the job, in pence. Null for internal jobs; operator-entered at
-- handoff for backfill jobs. See docs/shaping/backfill-drivers.
ALTER TABLE "bookings" ADD COLUMN "backfill_driver_pay_pence" integer;
