import { parsePickupInput } from '@/lib/dates';
import { optionalPhoneSchema, phoneSchema } from '@/lib/phone';
import { normalizeTravelRef } from '@/lib/travel-ref';
import type { Database } from '@/server/db';
import { type Booking, bookings, drivers } from '@/server/db/schema';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAuditEvent } from './audit';
import { mirrorBooking } from './mirror';

// A `datetime-local` value from the booking form is a bare Europe/London
// wall-clock string (no offset). `parsePickupInput` resolves it BST-aware rather
// than via `new Date(string)`, which would parse it in the server's zone (UTC on
// Vercel) and silently store the pickup +1h off in summer. Absolute instants
// (ISO with Z/offset) and Date objects pass through unchanged.
const pickupAtSchema = z.union([z.string(), z.date()]).transform((value, ctx) => {
  const parsed = parsePickupInput(value);
  if (!parsed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid pickup date/time' });
    return z.NEVER;
  }
  return parsed;
});

export const createBookingSchema = z
  .object({
    // Point-to-point `transfer` (default) or `hourly` as-directed hire.
    serviceType: z.enum(['transfer', 'hourly']).optional().default('transfer'),
    pickupAt: pickupAtSchema,
    expectedDurationMinutes: z.coerce
      .number()
      .int()
      .min(15, 'Duration must be at least 15 minutes')
      .max(720, 'Duration cannot exceed 12 hours'),
    // Route distance for transfers (metres); ignored/cleared for hourly.
    distanceMeters: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
    pickupAddress: z.string().min(3, 'Pickup address is required').max(500),
    // Required for transfers (enforced below); omitted for hourly (no destination).
    dropoffAddress: z.string().max(500).optional().nullable(),
    passengerFirstName: z.string().min(1, 'Passenger first name is required').max(80),
    passengerLastName: z.string().max(80).optional().nullable(),
    execMobile: phoneSchema,
    // Exec email — recipient when the email channel is active. Optional at the
    // schema level (SMS-mode bookings don't need one); the form requires it when
    // email is the active channel, and a missing one surfaces as a loud failed
    // notification rather than a silent drop.
    execEmail: z.string().email().max(200).optional().nullable(),
    // "Booked by" — the PA who booked on the exec's behalf. Optional as a
    // whole; a partially-filled section is rejected in the superRefine below.
    bookedByName: z.string().trim().max(120).optional().nullable(),
    bookedByPhone: optionalPhoneSchema,
    bookedByEmail: z
      .string()
      .trim()
      .email('Enter a valid email for the booked-by contact')
      .max(200)
      .optional()
      .nullable(),
    // Single "Customer Account" — the company/account billed for the trip.
    // Stored in account_code (+ mirrored into client_name for now).
    customerAccount: z.string().min(1, 'Customer account is required').max(120),
    // "Case code" — the expense code the customer's company bills against.
    caseCode: z.string().min(1, 'Case code is required').max(60),
    // Operator-set contract price. Optional — operators don't always know the
    // price at booking time; a booking without one is flagged in the console.
    // An explicit zero is rejected: blank means "not agreed yet", zero is a mistake.
    contractPricePence: z.coerce
      .number()
      .int()
      .min(1, 'Contract price must be a positive amount — leave it blank if not agreed yet')
      .max(10_000_00)
      .nullable()
      .optional(),
    // Price agreed for handing the job to a subcontractor (backfill) driver.
    subcontractorPricePence: z.coerce
      .number()
      .int()
      .min(1, 'Subcontractor price must be a positive amount — leave it blank if not agreed yet')
      .max(10_000_00)
      .nullable()
      .optional(),
    // Optional flight/train reference for airport / station pickups; shown to
    // the driver. Both fields together or neither (enforced below); the ref is
    // validated + normalized per mode in the superRefine.
    travelMode: z.enum(['flight', 'train']).optional().nullable(),
    travelRef: z.string().max(80).optional().nullable(),
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
    refineTravelRef(data, ctx);
    refineBookedBy(data, ctx);
  });

/**
 * Shared create/edit rule for the optional "Booked by" (PA) section: blank as a
 * whole is fine, but a partial fill is rejected — a name needs at least one
 * contact (phone or email), and a contact needs a name.
 */
export function refineBookedBy(
  data: {
    bookedByName?: string | null | undefined;
    bookedByPhone?: string | null | undefined;
    bookedByEmail?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const name = (data.bookedByName ?? '').trim();
  const hasContact = Boolean(data.bookedByPhone) || Boolean(data.bookedByEmail);
  if (!name && !hasContact) return;
  if (!name) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bookedByName'],
      message: 'Add the name of the person who booked',
    });
  }
  if (!hasContact) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['bookedByPhone'],
      message: 'Add a phone number or email for the person who booked',
    });
  }
}

/** The booked-by trio to persist: trimmed values, or all null when unset. */
export function normalizedBookedBy(data: {
  bookedByName?: string | null | undefined;
  bookedByPhone?: string | null | undefined;
  bookedByEmail?: string | null | undefined;
}): { bookedByName: string | null; bookedByPhone: string | null; bookedByEmail: string | null } {
  return {
    bookedByName: data.bookedByName?.trim() || null,
    bookedByPhone: data.bookedByPhone || null,
    bookedByEmail: data.bookedByEmail?.trim() || null,
  };
}

/**
 * Shared create/edit rule: travelMode and travelRef come as a pair, and the ref
 * must be valid for its mode. Runs inside each schema's superRefine.
 */
export function refineTravelRef(
  data: {
    travelMode?: 'flight' | 'train' | null | undefined;
    travelRef?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
): void {
  const mode = data.travelMode ?? null;
  const ref = data.travelRef ?? null;
  if (!mode && !ref) return;
  if (!mode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['travelMode'],
      message: 'Choose flight or train for the reference',
    });
    return;
  }
  const normalized = normalizeTravelRef(mode, ref ?? '');
  if (!normalized.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['travelRef'], message: normalized.error });
  }
}

/** The pair to persist: normalized ref, or both null when unset. */
export function normalizedTravelPair(data: {
  travelMode?: 'flight' | 'train' | null | undefined;
  travelRef?: string | null | undefined;
}): { travelMode: 'flight' | 'train' | null; travelRef: string | null } {
  const mode = data.travelMode ?? null;
  if (!mode) return { travelMode: null, travelRef: null };
  const normalized = normalizeTravelRef(mode, data.travelRef ?? '');
  // The schema's refine already rejected invalid refs; this is a type guard.
  return { travelMode: mode, travelRef: normalized.ok ? normalized.value : null };
}

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

  // The operator sets the prices manually; use them verbatim. Null means the
  // price isn't agreed yet — the console flags the booking until it is.
  const contractPricePence = parsed.data.contractPricePence ?? null;
  const subcontractorPricePence = parsed.data.subcontractorPricePence ?? null;

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
      ...normalizedTravelPair(parsed.data),
      passengerFirstName: parsed.data.passengerFirstName,
      passengerLastName: parsed.data.passengerLastName ?? null,
      execMobile: parsed.data.execMobile,
      execEmail: parsed.data.execEmail ?? null,
      ...normalizedBookedBy(parsed.data),
      // Customer Account lives in account_code; client_name is kept in sync
      // until that legacy column is dropped.
      clientName: parsed.data.customerAccount,
      accountCode: parsed.data.customerAccount,
      caseCode: parsed.data.caseCode,
      contractPricePence,
      subcontractorPricePence,
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
