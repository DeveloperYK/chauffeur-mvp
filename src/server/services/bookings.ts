import type { Database } from '@/server/db';
import { type Booking, bookings, drivers } from '@/server/db/schema';
import { PLACEHOLDER_PRICING_RULES, quoteBooking } from '@/server/domain/pricing';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { eq } from 'drizzle-orm';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';

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

export const createBookingSchema = z
  .object({
    // Point-to-point `transfer` (default) or `hourly` as-directed hire.
    serviceType: z.enum(['transfer', 'hourly']).optional().default('transfer'),
    pickupAt: z.coerce.date(),
    expectedDurationMinutes: z.coerce.number().int().min(15).max(720),
    // Route distance for transfers (metres); ignored/cleared for hourly.
    distanceMeters: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
    pickupAddress: z.string().min(3).max(500),
    // Required for transfers (enforced below); omitted for hourly (no destination).
    dropoffAddress: z.string().max(500).optional().nullable(),
    passengerFirstName: z.string().min(1).max(80),
    passengerLastName: z.string().max(80).optional().nullable(),
    execMobile: phoneSchema,
    // Single "Customer Account" — the company/account billed for the trip.
    // Stored in account_code (+ mirrored into client_name for now).
    customerAccount: z.string().min(1, 'Customer account is required').max(120),
    // "Case code" — the expense code the customer's company bills against.
    caseCode: z.string().min(1, 'Case code is required').max(60),
    contractPricePence: z.coerce.number().int().min(0).max(10_000_00),
    // Driver-facing notes (shown to the driver on the dispatch link).
    notes: z.string().max(2000).optional().nullable(),
    // Operator-only notes — never shown to the driver.
    operatorNotes: z.string().max(2000).optional().nullable(),
    // Optional: assign driver at booking creation
    assignedDriverId: z.string().uuid().optional().nullable(),
    markAsAccepted: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((data, ctx) => {
    // A transfer must have a destination; an hourly hire must not.
    if (data.serviceType === 'transfer' && (data.dropoffAddress ?? '').trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dropoffAddress'],
        message: 'Destination is required for a transfer',
      });
    }
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export interface CreateBookingDeps {
  db: Database;
  clock?: Clock;
  operatorId: string;
  mirror?: SpreadsheetMirrorPort;
}

export type CreateBookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'pickup_in_past' }
  | { ok: false; reason: 'driver_not_found' }
  | { ok: false; reason: 'driver_inactive' };

export async function createBooking(
  raw: unknown,
  deps: CreateBookingDeps,
): Promise<CreateBookingResult> {
  const clock = deps.clock ?? systemClock;
  const parsed = createBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }

  const now = clock.now();
  if (parsed.data.pickupAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'pickup_in_past' };
  }

  // If assigning driver at creation, validate the driver exists and is active
  let driver: { id: string } | null = null;
  if (parsed.data.assignedDriverId) {
    const [found] = await deps.db
      .select({ id: drivers.id, active: drivers.active })
      .from(drivers)
      .where(eq(drivers.id, parsed.data.assignedDriverId))
      .limit(1);
    if (!found) return { ok: false, reason: 'driver_not_found' };
    if (!found.active) return { ok: false, reason: 'driver_inactive' };
    driver = { id: found.id };
  }

  const shouldMarkAssigned = driver !== null && parsed.data.markAsAccepted;

  // Hourly hire has no destination or route distance; a transfer keeps both.
  const isHourly = parsed.data.serviceType === 'hourly';
  const dropoffAddress = isHourly ? null : (parsed.data.dropoffAddress ?? null);
  const distanceMeters = isHourly ? null : (parsed.data.distanceMeters ?? null);

  // Price defaults to the computed quote when the operator leaves it blank (0),
  // otherwise their entered/overridden figure wins.
  const contractPricePence =
    parsed.data.contractPricePence > 0
      ? parsed.data.contractPricePence
      : quoteBooking(
          isHourly
            ? { serviceType: 'hourly', hours: parsed.data.expectedDurationMinutes / 60 }
            : { serviceType: 'transfer', distanceMeters: distanceMeters ?? 0 },
          PLACEHOLDER_PRICING_RULES,
        ).amountPence;

  const [inserted] = await deps.db
    .insert(bookings)
    .values({
      state: shouldMarkAssigned ? 'assigned' : 'unassigned',
      serviceType: parsed.data.serviceType,
      pickupAt: parsed.data.pickupAt,
      expectedDurationMinutes: parsed.data.expectedDurationMinutes,
      distanceMeters,
      pickupAddress: parsed.data.pickupAddress,
      dropoffAddress,
      passengerFirstName: parsed.data.passengerFirstName,
      passengerLastName: parsed.data.passengerLastName ?? null,
      execMobile: parsed.data.execMobile,
      // Customer Account lives in account_code; client_name is kept in sync
      // until that legacy column is dropped.
      clientName: parsed.data.customerAccount,
      accountCode: parsed.data.customerAccount,
      caseCode: parsed.data.caseCode,
      contractPricePence,
      notes: parsed.data.notes ?? null,
      operatorNotes: parsed.data.operatorNotes ?? null,
      createdByOperatorId: deps.operatorId,
      assignedOperatorId: deps.operatorId,
      // Driver assignment at creation (if markAsAccepted)
      assignedDriverId: shouldMarkAssigned && driver ? driver.id : null,
      assignedAt: shouldMarkAssigned ? now : null,
    })
    .returning();

  if (!inserted) {
    throw new Error('insert returned no row');
  }

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: deps.operatorId,
    entityType: 'booking',
    entityId: inserted.id,
    action: 'create',
    before: null,
    after: {
      state: inserted.state,
      ...(shouldMarkAssigned && driver ? { driverId: driver.id, markedAccepted: true } : {}),
    },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, inserted);

  return { ok: true, booking: inserted };
}
