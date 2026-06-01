-- Operator-completed form support. When a driver is slow/unreachable the
-- operator can enter the completion data themselves (by phone) and complete the
-- booking directly, skipping the operator-review stage. This flag marks those
-- bookings so the board/detail and audit can show they were completed by the
-- operator on the driver's behalf. See docs/shaping/operator-complete-form.
ALTER TABLE "bookings" ADD COLUMN "completion_by_operator" boolean DEFAULT false NOT NULL;
