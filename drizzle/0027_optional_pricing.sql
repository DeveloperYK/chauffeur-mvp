-- Optional pricing: operators don't always know the contract price when the
-- booking call comes in, and may agree a separate price for handing the job to
-- a subcontractor (backfill) driver. Bookings without a contract price are
-- flagged in the console until one is set.
ALTER TABLE "bookings" ALTER COLUMN "contract_price_pence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "subcontractor_price_pence" integer;
