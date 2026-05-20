import type { Database } from '@/server/db';
import { type Booking, type Operator, bookings, operators } from '@/server/db/schema';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { asc, eq } from 'drizzle-orm';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';

export interface OperatorSummary {
  id: string;
  name: string;
  email: string;
}

/** Active operators, name-sorted — for assignee pickers and board filters. */
export async function listOperators(db: Database): Promise<OperatorSummary[]> {
  const rows = await db
    .select({ id: operators.id, name: operators.name, email: operators.email })
    .from(operators)
    .where(eq(operators.active, true))
    .orderBy(asc(operators.name));
  return rows;
}

export async function getOperator(db: Database, id: string): Promise<Operator | null> {
  const rows = await db.select().from(operators).where(eq(operators.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface AssignDeps {
  db: Database;
  mirror?: SpreadsheetMirrorPort;
}

export type AssignResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'booking_not_found' | 'operator_not_found' };

/**
 * Reassign a booking's owning operator. `targetOperatorId` of null unassigns.
 * `byOperatorId` is the operator performing the action (for the audit trail).
 */
export async function assignOperator(
  bookingId: string,
  targetOperatorId: string | null,
  byOperatorId: string,
  deps: AssignDeps,
): Promise<AssignResult> {
  const [existing] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!existing) return { ok: false, reason: 'booking_not_found' };

  if (targetOperatorId !== null) {
    const target = await getOperator(deps.db, targetOperatorId);
    if (!target || !target.active) return { ok: false, reason: 'operator_not_found' };
  }

  const [updated] = await deps.db
    .update(bookings)
    .set({ assignedOperatorId: targetOperatorId, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();
  if (!updated) return { ok: false, reason: 'booking_not_found' };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: byOperatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'assign_operator',
    before: { assignedOperatorId: existing.assignedOperatorId },
    after: { assignedOperatorId: targetOperatorId },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated };
}

/** Look up name/email for a set of operator ids — for rendering assignee labels. */
export async function operatorsById(
  db: Database,
  ids: string[],
): Promise<Map<string, OperatorSummary>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: operators.id, name: operators.name, email: operators.email })
    .from(operators);
  const map = new Map<string, OperatorSummary>();
  for (const r of rows) {
    if (unique.includes(r.id)) map.set(r.id, r);
  }
  return map;
}
