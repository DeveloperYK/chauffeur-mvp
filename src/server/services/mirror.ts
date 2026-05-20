import { logger } from '@/lib/logger';
import type { Database } from '@/server/db';
import { type Booking, drivers, operators } from '@/server/db/schema';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { eq } from 'drizzle-orm';

/** Fire-and-forget write to the spreadsheet mirror. Failures log but never
 * throw — the dashboard must remain available even when the mirror is down. */
export async function mirrorBooking(
  db: Database,
  mirror: SpreadsheetMirrorPort,
  booking: Booking,
): Promise<void> {
  let driver = null;
  if (booking.assignedDriverId) {
    const rows = await db
      .select()
      .from(drivers)
      .where(eq(drivers.id, booking.assignedDriverId))
      .limit(1);
    driver = rows[0] ?? null;
  }

  let operator = null;
  if (booking.createdByOperatorId) {
    const rows = await db
      .select()
      .from(operators)
      .where(eq(operators.id, booking.createdByOperatorId))
      .limit(1);
    operator = rows[0] ?? null;
  }

  try {
    const result = await mirror.upsertRow({ booking, driver, operator });
    if (!result.ok) {
      logger.warn({ bookingId: booking.id, reason: result.reason }, 'mirror upsert failed');
    }
  } catch (err) {
    logger.error({ err, bookingId: booking.id }, 'mirror threw');
  }
}
