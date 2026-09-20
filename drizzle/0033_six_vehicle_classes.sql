-- Replace the 4-value driver vehicle class (executive / luxury / mpv / coach)
-- with JJ's six vehicle types, the same list the booking's requested car type
-- quick-picks offer — so a booking's ask and a driver's class line up 1:1 and
-- the console can flag a mismatch (7- vs 8-seater, electric-only) exactly.
--
--   executive  Ex   – Executive
--   vip        VIP  – S Class
--   mpv_s      MPV S – 7 Seater
--   mpv_l      MPV L – 8 Seater
--   e_car      E Car – Electric Only
--   coach      C    – Coach
--
-- Postgres can't drop values from an enum, so the type is rebuilt. Every
-- existing driver is remapped to 'executive' (operator decision: re-classify
-- by hand on the roster rather than guess MPV sizes from the old 'mpv').
--
-- Rollback: rebuild the old type the same way, mapping vip → luxury,
-- mpv_s / mpv_l → mpv, e_car → executive.

ALTER TYPE "public"."vehicle_class" RENAME TO "vehicle_class_old";

CREATE TYPE "public"."vehicle_class" AS ENUM('executive', 'vip', 'mpv_s', 'mpv_l', 'e_car', 'coach');

-- Rebuilding the column type rebuilds drivers_vehicle_class_active_idx too.
ALTER TABLE "drivers"
  ALTER COLUMN "vehicle_class" TYPE "public"."vehicle_class"
  USING ('executive'::"public"."vehicle_class");

DROP TYPE "public"."vehicle_class_old";
