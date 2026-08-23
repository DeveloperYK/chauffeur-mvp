import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';

/**
 * Set (or clear) a booking's contract price directly, the way the waiting
 * charge is overridden. Exists so a booking that ran without an agreed price —
 * flagged "no price" in the console — can be priced whenever the operator
 * learns it, including after completion, when the full edit flow is closed
 * (completed bookings are otherwise immutable). Cancelled bookings are never
 * billed, so they stay untouchable. `null` clears the price; a value must be
 * a positive amount up to £10,000, like the booking forms.
 */
const priceSchema = z.union([z.null(), z.coerce.number().int().min(1).max(10_000_00)]);

export interface SetContractPriceDeps {
  db: Database;
  clock?: Clock;
  mirror?: SpreadsheetMirrorPort;
}

export type SetContractPriceResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation' }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'not_editable'; state: string };

export async function setContractPrice(
  bookingId: string,
  pricePence: number | null,
  operatorId: string,
  deps: SetContractPriceDeps,
): Promise<SetContractPriceResult> {
  const parsed = priceSchema.safeParse(pricePence);
  if (!parsed.success) return { ok: false, reason: 'validation' };

  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };
  if (booking.state === 'cancelled') {
    return { ok: false, reason: 'not_editable', state: booking.state };
  }

  const [updated] = await deps.db
    .update(bookings)
    .set({ contractPricePence: parsed.data, updatedAt: clock.now() })
    .where(eq(bookings.id, booking.id))
    .returning();
  if (!updated) return { ok: false, reason: 'booking_not_found' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'set_contract_price',
    before: { contractPricePence: booking.contractPricePence },
    after: { contractPricePence: parsed.data },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}
