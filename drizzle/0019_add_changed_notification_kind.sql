-- Exec re-notify on mid-flight change (docs/shaping/mid-flight-changes V3).
-- Adds a `changed` value to the notification_kind enum so an operator-triggered
-- "booking updated" exec message is tracked distinctly from the automated
-- `assigned` / `en_route` sends. ADD VALUE only (not used in this statement), so
-- it is safe outside a transaction on PG12+.
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'changed';
