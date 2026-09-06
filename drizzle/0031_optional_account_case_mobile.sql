-- Customer account, client name and exec mobile become optional. Operators
-- don't always have them at booking time; the driver never needs them and
-- exec notifications go by email. Backward-compatible: dropping NOT NULL only.
ALTER TABLE "bookings" ALTER COLUMN "client_name" DROP NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "account_code" DROP NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "exec_mobile" DROP NOT NULL;
