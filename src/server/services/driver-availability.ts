import type { Database } from '@/server/db';
import { type DriverTimeOff, driverTimeOff, drivers } from '@/server/db/schema';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';

/**
 * Driver availability service.
 *
 * Models planned, time-bounded driver unavailability — distinct from
 * `drivers.active` (a global on/off kill-switch). A `driver_time_off` row
 * marks a driver as unavailable for the inclusive whole-day range
 * `[startsOn, endsOn]`.
 *
 * Decisions baked in (docs/shaping/driver-availability/shaping.md):
 * - whole days only — no half-days, no time-of-day precision
 * - no recurring patterns — ad-hoc one-off date ranges
 * - no reason field — operators capture context out-of-band
 */

export interface AvailabilityDeps {
  db: Database;
}

// Dates flow through this service as ISO `YYYY-MM-DD` strings — matches the
// `date` column type and avoids any timezone interpretation. The DB column
// has a `CHECK (ends_on >= starts_on)` constraint; we also enforce it here
// so the caller gets a typed `validation` reason instead of a DB error.
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date');

const setSchema = z
  .object({
    driverId: z.string().uuid(),
    startsOn: dateSchema,
    endsOn: dateSchema,
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, {
    path: ['endsOn'],
    message: 'endsOn must be the same day as or after startsOn',
  });

export type SetDriverTimeOffInput = z.infer<typeof setSchema>;

export type SetDriverTimeOffResult =
  | { ok: true; timeOff: DriverTimeOff }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'driver_not_found' };

export async function setDriverTimeOff(
  raw: unknown,
  operatorId: string,
  deps: AvailabilityDeps,
): Promise<SetDriverTimeOffResult> {
  const parsed = setSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }
  const input = parsed.data;

  const [driver] = await deps.db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.id, input.driverId))
    .limit(1);
  if (!driver) return { ok: false, reason: 'driver_not_found' };

  const [row] = await deps.db
    .insert(driverTimeOff)
    .values({
      driverId: input.driverId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      createdByOperatorId: operatorId,
    })
    .returning();
  if (!row) return { ok: false, reason: 'validation', issues: [] };

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'driver',
    entityId: input.driverId,
    action: 'driver_time_off_set',
    before: null,
    after: { id: row.id, startsOn: row.startsOn, endsOn: row.endsOn },
  });

  return { ok: true, timeOff: row };
}

export type ClearDriverTimeOffResult = { ok: true } | { ok: false; reason: 'not_found' };

export async function clearDriverTimeOff(
  timeOffId: string,
  operatorId: string,
  deps: AvailabilityDeps,
): Promise<ClearDriverTimeOffResult> {
  const [existing] = await deps.db
    .select()
    .from(driverTimeOff)
    .where(eq(driverTimeOff.id, timeOffId))
    .limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };

  await deps.db.delete(driverTimeOff).where(eq(driverTimeOff.id, timeOffId));

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'driver',
    entityId: existing.driverId,
    action: 'driver_time_off_cleared',
    before: {
      id: existing.id,
      startsOn: existing.startsOn,
      endsOn: existing.endsOn,
    },
    after: null,
  });

  return { ok: true };
}

/**
 * Cheap point-check: is this driver scheduled off on this specific date?
 * Date is the ISO `YYYY-MM-DD` of the pickup day in whatever timezone the
 * caller cares about (typically Europe/London for booking pickups).
 */
export async function isDriverOffOn(
  db: Database,
  driverId: string,
  date: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: driverTimeOff.id })
    .from(driverTimeOff)
    .where(
      and(
        eq(driverTimeOff.driverId, driverId),
        lte(driverTimeOff.startsOn, date),
        gte(driverTimeOff.endsOn, date),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Range query: every time-off row for a driver whose range overlaps
 * `[from, to]` (both inclusive). Used by the time-off modal to render the
 * driver's currently-scheduled upcoming off-time.
 */
export async function listDriverTimeOff(
  db: Database,
  driverId: string,
  from: string,
  to: string,
): Promise<DriverTimeOff[]> {
  return db
    .select()
    .from(driverTimeOff)
    .where(
      and(
        eq(driverTimeOff.driverId, driverId),
        lte(driverTimeOff.startsOn, to),
        gte(driverTimeOff.endsOn, from),
      ),
    )
    .orderBy(asc(driverTimeOff.startsOn));
}

/**
 * Roster query: every still-relevant time-off row across all drivers,
 * grouped by driver id. "Relevant" = ends today or later (London). Used by
 * the drivers page to render the "Off <range>" lozenge.
 */
export async function listAllUpcomingTimeOff(
  db: Database,
  todayLondon: string,
): Promise<Record<string, DriverTimeOff[]>> {
  const rows = await db
    .select()
    .from(driverTimeOff)
    .where(gte(driverTimeOff.endsOn, todayLondon))
    .orderBy(asc(driverTimeOff.startsOn));

  const out: Record<string, DriverTimeOff[]> = {};
  for (const r of rows) {
    const list = out[r.driverId] ?? [];
    list.push(r);
    out[r.driverId] = list;
  }
  return out;
}
