-- Operator override of the waiting charge (pence). Null means "use the computed
-- £1/min × waiting minutes"; a non-null value is the operator's adjusted amount,
-- the way the contract price can be set by hand. Backward-compatible (nullable).
ALTER TABLE "bookings" ADD COLUMN "waiting_charge_pence" integer;
