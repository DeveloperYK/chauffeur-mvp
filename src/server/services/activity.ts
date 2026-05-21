import type { Database } from '@/server/db';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { desc, inArray } from 'drizzle-orm';

export interface ActivityEvent {
  id: string;
  ts: Date;
  actor: string;
  text: string;
  bookingId: string;
}

const PASSENGER_FALLBACK = 'a booking';

function describe(action: string, passenger: string, after: unknown): string {
  const a = (after ?? {}) as { reason?: string; state?: string };
  switch (action) {
    case 'create':
      return `created the booking for ${passenger}.`;
    case 'dispatch_link_generated':
      return `generated a dispatch link for ${passenger}.`;
    case 'driver_accept':
      return `accepted the job for ${passenger}.`;
    case 'driver_decline':
      return `declined the job for ${passenger}.`;
    case 'clock_pickup_minus_1h':
      return `marked ${passenger} in progress and notified the passenger.`;
    case 'clock_expected_end':
      return `moved ${passenger} to awaiting the driver's form.`;
    case 'auto_flag_no_accept':
      return `flagged ${passenger} — no driver accepted in time.`;
    case 'completion_link_generated':
      return `generated a completion link for ${passenger}.`;
    case 'driver_submit_form':
      return `submitted the completion form for ${passenger}.`;
    case 'operator_approve':
      return `approved and completed the trip for ${passenger}.`;
    case 'operator_reject':
      return `rejected the completion form for ${passenger}.`;
    case 'assign_operator':
      return `reassigned the operator for ${passenger}.`;
    case 'cancel':
      return `cancelled ${passenger}${a.reason ? ` — ${a.reason}` : ''}.`;
    case 'simulator_force_state':
      return `forced ${passenger} to ${a.state ?? 'a new state'} (simulator).`;
    default:
      return `updated ${passenger}.`;
  }
}

/** Recent audit events, resolved to human-readable rows. */
export async function listActivity(db: Database, limit = 60): Promise<ActivityEvent[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
  const bookingIds = [...new Set(rows.map((r) => r.entityId))];

  const [ops, drvs, bks] = await Promise.all([
    actorIds.length
      ? db.select().from(operators).where(inArray(operators.id, actorIds))
      : Promise.resolve([]),
    actorIds.length
      ? db.select().from(drivers).where(inArray(drivers.id, actorIds))
      : Promise.resolve([]),
    bookingIds.length
      ? db.select().from(bookings).where(inArray(bookings.id, bookingIds))
      : Promise.resolve([]),
  ]);
  const opName = new Map(ops.map((o) => [o.id, o.name]));
  const drvName = new Map(drvs.map((d) => [d.id, d.name]));
  const passenger = new Map(
    bks.map((b) => [b.id, `${b.passengerFirstName} ${b.passengerLastName}`]),
  );

  return rows.map((r) => {
    const actor =
      r.actorType === 'system'
        ? 'System'
        : r.actorType === 'driver'
          ? r.actorId
            ? (drvName.get(r.actorId) ?? 'Driver')
            : 'Driver'
          : r.actorId
            ? (opName.get(r.actorId) ?? 'Operator')
            : 'Operator';
    return {
      id: r.id,
      ts: r.createdAt,
      actor,
      text: describe(r.action, passenger.get(r.entityId) ?? PASSENGER_FALLBACK, r.after),
      bookingId: r.entityId,
    };
  });
}
