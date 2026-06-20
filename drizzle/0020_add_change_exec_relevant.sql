-- Auto exec-email on confirmed exec-relevant change (docs/shaping/mid-flight-changes).
-- Flags, at edit time, whether the pending change touched something the exec was
-- told (time / pickup / destination). On confirmation, an exec-relevant change
-- auto-emails the exec; driver-only changes stay silent to the exec.
ALTER TABLE "bookings" ADD COLUMN "change_exec_relevant" boolean DEFAULT false NOT NULL;
