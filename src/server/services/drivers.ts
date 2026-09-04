import { phoneSchema } from '@/lib/phone';
import type { Database } from '@/server/db';
import { type Driver, drivers } from '@/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';

export const createDriverSchema = z
  .object({
    name: z.string().min(2).max(120),
    vehicleClass: z.enum(['executive', 'luxury', 'mpv', 'coach']),
    car: z.string().trim().min(1).max(80),
    carColour: z.string().trim().min(1).max(40),
    // Optional registration plate, shown to the exec in the email.
    numberPlate: z.string().trim().max(15).optional().nullable(),
    // PCO licence number, shown to the exec in the email. Required on every
    // create/edit (the DB column stays nullable for pre-existing rows).
    pcoNumber: z.string().trim().min(1).max(20),
    // The vehicle's PCO licence number — compliance-only, never exposed
    // outside the operator console. Optional: legacy rows predate the field.
    carPcoNumber: z.string().trim().max(20).optional().nullable(),
    whatsappNumber: phoneSchema,
  })
  .strict();

export const updateDriverSchema = createDriverSchema.partial().extend({
  active: z.boolean().optional(),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;

export interface DriverServiceDeps {
  db: Database;
  operatorId: string;
}

export type CreateDriverResult =
  | { ok: true; driver: Driver }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'duplicate_whatsapp' };

export async function createDriver(
  raw: unknown,
  deps: DriverServiceDeps,
): Promise<CreateDriverResult> {
  const parsed = createDriverSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }

  try {
    // Normalise the optional fields to null (not undefined) for the insert —
    // exactOptionalPropertyTypes forbids `undefined` in Drizzle's values type.
    const { numberPlate, carPcoNumber, ...rest } = parsed.data;
    const [inserted] = await deps.db
      .insert(drivers)
      .values({
        ...rest,
        numberPlate: numberPlate ?? null,
        carPcoNumber: carPcoNumber?.trim() || null,
      })
      .returning();
    if (!inserted) throw new Error('insert returned no row');
    await recordAuditEvent(deps.db, {
      actorType: 'operator',
      actorId: deps.operatorId,
      entityType: 'driver',
      entityId: inserted.id,
      action: 'create',
      before: null,
      after: {
        name: inserted.name,
        vehicleClass: inserted.vehicleClass,
        car: inserted.car,
        carColour: inserted.carColour,
        numberPlate: inserted.numberPlate,
        pcoNumber: inserted.pcoNumber,
        carPcoNumber: inserted.carPcoNumber,
      },
    });
    return { ok: true, driver: inserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('drivers_whatsapp_idx') || msg.toLowerCase().includes('unique')) {
      return { ok: false, reason: 'duplicate_whatsapp' };
    }
    throw err;
  }
}

export type UpdateDriverResult =
  | { ok: true; driver: Driver }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'duplicate_whatsapp' };

export async function updateDriver(
  id: string,
  raw: unknown,
  deps: DriverServiceDeps,
): Promise<UpdateDriverResult> {
  const parsed = updateDriverSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }

  const [existing] = await deps.db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };

  // Strip undefined keys — exactOptionalPropertyTypes forbids them in Drizzle's
  // `.set()` signature.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) patch[k] = v;
  }
  // A cleared car PCO comes through as an empty string — store null instead.
  if (typeof patch.carPcoNumber === 'string') patch.carPcoNumber = patch.carPcoNumber || null;

  try {
    const [updated] = await deps.db
      .update(drivers)
      .set(patch)
      .where(eq(drivers.id, id))
      .returning();
    if (!updated) return { ok: false, reason: 'not_found' };

    await recordAuditEvent(deps.db, {
      actorType: 'operator',
      actorId: deps.operatorId,
      entityType: 'driver',
      entityId: updated.id,
      action: 'update',
      before: {
        name: existing.name,
        vehicleClass: existing.vehicleClass,
        car: existing.car,
        carColour: existing.carColour,
        numberPlate: existing.numberPlate,
        pcoNumber: existing.pcoNumber,
        carPcoNumber: existing.carPcoNumber,
        active: existing.active,
      },
      after: {
        name: updated.name,
        vehicleClass: updated.vehicleClass,
        car: updated.car,
        carColour: updated.carColour,
        numberPlate: updated.numberPlate,
        pcoNumber: updated.pcoNumber,
        carPcoNumber: updated.carPcoNumber,
        active: updated.active,
      },
    });
    return { ok: true, driver: updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('drivers_whatsapp_idx') || msg.toLowerCase().includes('unique')) {
      return { ok: false, reason: 'duplicate_whatsapp' };
    }
    throw err;
  }
}

export async function deactivateDriver(
  id: string,
  deps: DriverServiceDeps,
): Promise<UpdateDriverResult> {
  return updateDriver(id, { active: false }, deps);
}

export async function listActiveDrivers(db: Database): Promise<Driver[]> {
  return db
    .select()
    .from(drivers)
    .where(eq(drivers.active, true))
    .orderBy(asc(drivers.vehicleClass), asc(drivers.name));
}

export async function listAllDrivers(db: Database): Promise<Driver[]> {
  return db
    .select()
    .from(drivers)
    .orderBy(asc(drivers.active), asc(drivers.vehicleClass), asc(drivers.name));
}

export async function getDriver(db: Database, id: string): Promise<Driver | null> {
  const rows = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function findDriverByWhatsapp(
  db: Database,
  whatsappNumber: string,
): Promise<Driver | null> {
  const rows = await db
    .select()
    .from(drivers)
    .where(and(eq(drivers.whatsappNumber, whatsappNumber), eq(drivers.active, true)))
    .limit(1);
  return rows[0] ?? null;
}
