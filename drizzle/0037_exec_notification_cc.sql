-- Carbon-copy recipients on exec emails. Operators can now copy the PA (or
-- the exec, when the PA is the To) and ad-hoc addresses on each send; the
-- message trail shows who else received it. Empty array for every existing
-- row and for SMS. No index: read only alongside the booking's own trail.
--
-- Rollback:
--   ALTER TABLE "exec_notifications" DROP COLUMN "cc";

ALTER TABLE "exec_notifications" ADD COLUMN "cc" text[] NOT NULL DEFAULT '{}'::text[];
