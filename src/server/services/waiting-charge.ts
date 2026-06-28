import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';

/**
 * Operator override of a booking's waiting charge, the way they set the contract
 * price by hand. `null` clears the override so the charge falls back to the
 * computed £1/min × waiting minutes; a number (£0–£10,000 in pence) pins it.
 */
const chargeSchema = z.union([z.null(), z.coerce.number().int().min(0).max(1_000_00)]);

export interface SetWaitingChargeDeps {
  db: Database;
  clock?: Clock;
}

export type SetWaitingChargeResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation' }
  | { ok: false; reason: 'booking_not_found' };

export async function setWaitingCharge(
  bookingId: string,
  chargePence: number | null,
  operatorId: string,
  deps: SetWaitingChargeDeps,
): Promise<SetWaitingChargeResult> {
  const parsed = chargeSchema.safeParse(chargePence);
  if (!parsed.success) return { ok: false, reason: 'validation' };

  const clock = deps.clock ?? systemClock;
  const [booking] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking) return { ok: false, reason: 'booking_not_found' };

  const [updated] = await deps.db
    .update(bookings)
    .set({ waitingChargePence: parsed.data, updatedAt: clock.now() })
    .where(eq(bookings.id, booking.id))
    .returning();
  if (!updated) return { ok: false, reason: 'booking_not_found' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: booking.id,
    action: 'set_waiting_charge',
    before: { waitingChargePence: booking.waitingChargePence },
    after: { waitingChargePence: parsed.data },
  });

  return { ok: true, booking: updated };
}
