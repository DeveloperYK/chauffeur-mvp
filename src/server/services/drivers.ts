import type { Database } from '@/server/db';
import { type Driver, drivers } from '@/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { recordAuditEvent } from './audit';

const phoneSchema = z
  .string()
  .min(7)
  .max(20)
  .refine((v) => parsePhoneNumberFromString(v)?.isValid() ?? false, {
    message: 'invalid phone number',
  })
  .transform((v) => {
    const parsed = parsePhoneNumberFromString(v);
    if (!parsed) throw new Error('invalid phone number');
    return parsed.format('E.164');
  });

export const createDriverSchema = z
  .object({
    name: z.string().min(2).max(120),
    tier: z.enum(['premium', 'ordinary']),
    defaultCarType: z.enum(['ex', 's_class', 'mpv', 'mini_bus']),
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
    const [inserted] = await deps.db.insert(drivers).values(parsed.data).returning();
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
        tier: inserted.tier,
        defaultCarType: inserted.defaultCarType,
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
        tier: existing.tier,
        defaultCarType: existing.defaultCarType,
        active: existing.active,
      },
      after: {
        name: updated.name,
        tier: updated.tier,
        defaultCarType: updated.defaultCarType,
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
    .orderBy(asc(drivers.tier), asc(drivers.name));
}

export async function listAllDrivers(db: Database): Promise<Driver[]> {
  return db
    .select()
    .from(drivers)
    .orderBy(asc(drivers.active), asc(drivers.tier), asc(drivers.name));
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
