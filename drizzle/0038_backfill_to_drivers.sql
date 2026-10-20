-- The backfill (subcontractor hand-off) flow is retired: subcontractors are
-- ordinary roster drivers now (ADR 0029). Fold every booking that was covered
-- by a free-text backfill driver into a real driver assignment so its history
-- keeps a driver once the application stops reading the backfill columns:
--   1. one driver row per distinct subcontractor phone (inactive, so it does
--      not appear in dispatch until an operator reviews it); an existing
--      roster driver with the same WhatsApp number is reused;
--   2. the booking points at that driver, operator-attested;
--   3. the recorded subcontractor pay becomes the subcontractor price when
--      none was agreed, so the sheet's Driver Cost column keeps its value.
-- The legacy columns (is_backfill, backfill_*) are left in place, unread, so
-- the change is backward-compatible and reversible. Idempotent.
--
-- Rollback (data only; the columns were never dropped):
--   UPDATE bookings SET assigned_driver_id = NULL, assignment_method = NULL
--     WHERE is_backfill AND assigned_driver_id IN (SELECT id FROM drivers WHERE active = false);
--   -- then delete the inactive drivers created here if unwanted.

INSERT INTO "drivers" ("name", "vehicle_class", "car", "car_colour", "whatsapp_number", "active")
SELECT DISTINCT ON ("backfill_driver_phone")
  COALESCE(NULLIF(TRIM("backfill_driver_name"), ''), 'Subcontractor'),
  'executive',
  COALESCE(NULLIF(TRIM("backfill_car"), ''), 'Unknown'),
  'Unknown',
  "backfill_driver_phone",
  false
FROM "bookings"
WHERE "is_backfill" = true AND "backfill_driver_phone" IS NOT NULL
ORDER BY "backfill_driver_phone", ("backfill_car" IS NULL), "created_at" DESC
ON CONFLICT ("whatsapp_number") DO NOTHING;--> statement-breakpoint

UPDATE "bookings" b
SET "assigned_driver_id" = d."id",
    "assignment_method" = 'operator_attested'
FROM "drivers" d
WHERE b."is_backfill" = true
  AND b."assigned_driver_id" IS NULL
  AND d."whatsapp_number" = b."backfill_driver_phone";--> statement-breakpoint

UPDATE "bookings"
SET "subcontractor_price_pence" = "backfill_driver_pay_pence"
WHERE "is_backfill" = true
  AND "subcontractor_price_pence" IS NULL
  AND "backfill_driver_pay_pence" IS NOT NULL;
