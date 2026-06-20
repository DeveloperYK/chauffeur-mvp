-- Operator-attested assignment (docs/shaping/mid-flight-changes V2).
-- Records HOW the assigned driver was committed: `driver_self` (tapped their
-- dispatch link) or `operator_attested` (operator phoned them and marked it
-- confirmed — direct assign or swap). Null for unassigned/backfill jobs. Reuses
-- the confirmation_method enum added in 0017.
ALTER TABLE "bookings" ADD COLUMN "assignment_method" "confirmation_method";
