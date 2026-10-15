/**
 * "Mark as handled" for the operator's exec emails. The booking panel flags
 * the confirmation, driver-details and booking-update emails until each is
 * sent; sometimes the operator has already told the exec by phone or from
 * their own mailbox, or the trip is under way and the email is moot. Waiving
 * stamps `*_email_waived_at` on the booking so the flag, the tile tag and the
 * "Send exec emails" view treat the email as settled — without recording a
 * send that never happened. Reversible (`waived: false`) and audited both ways.
 * See docs/adr/0023-exec-email-waiver.md.
 */
import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';

const waiverSchema = z
  .object({
    bookingId: z.string().uuid(),
    kind: z.enum(['assigned', 'en_route', 'changed']),
    waived: z.boolean(),
  })
  .strict();

export type ExecEmailWaiverInput = z.infer<typeof waiverSchema>;

export type ExecEmailWaiverResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' };

const COLUMN: Record<
  ExecEmailWaiverInput['kind'],
  'confirmationEmailWaivedAt' | 'driverDetailsEmailWaivedAt' | 'changeUpdateEmailWaivedAt'
> = {
  assigned: 'confirmationEmailWaivedAt',
  en_route: 'driverDetailsEmailWaivedAt',
  changed: 'changeUpdateEmailWaivedAt',
};

/**
 * Set or clear the waiver for one email kind. Idempotent: waiving an already
 * waived email keeps the original stamp (and still writes an audit row, so the
 * trail shows the operator's intent).
 */
export async function waiveExecEmail(
  db: Database,
  raw: unknown,
  operatorId: string,
): Promise<ExecEmailWaiverResult> {
  const parsed = waiverSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'validation', issues: parsed.error.issues };
  const { bookingId, kind, waived } = parsed.data;
  const column = COLUMN[kind];

  const [before] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!before) return { ok: false, reason: 'booking_not_found' };

  const nextValue = waived ? (before[column] ?? new Date()) : null;
  const [after] = await db
    .update(bookings)
    .set({ [column]: nextValue, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();
  if (!after) return { ok: false, reason: 'booking_not_found' };

  await recordAuditEvent(db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: waived ? 'waive_exec_email' : 'unwaive_exec_email',
    before: { kind, waivedAt: before[column]?.toISOString() ?? null },
    after: { kind, waivedAt: after[column]?.toISOString() ?? null },
  });

  return { ok: true, booking: after };
}
