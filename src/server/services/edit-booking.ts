import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { and, eq } from 'drizzle-orm';
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

export const editBookingSchema = z
  .object({
    bookingId: z.string().uuid(),
    serviceType: z.enum(['transfer', 'hourly']).optional().default('transfer'),
    pickupAt: z.coerce.date(),
    expectedDurationMinutes: z.coerce.number().int().min(15).max(720),
    distanceMeters: z.coerce.number().int().min(0).max(2_000_000).optional().nullable(),
    pickupAddress: z.string().min(3).max(500),
    dropoffAddress: z.string().max(500).optional().nullable(),
    passengerFirstName: z.string().min(1).max(80),
    passengerLastName: z.string().max(80).optional().nullable(),
    execMobile: phoneSchema,
    customerAccount: z.string().min(1, 'Customer account is required').max(120),
    caseCode: z.string().min(1, 'Case code is required').max(60),
    contractPricePence: z.coerce.number().int().min(1, 'Contract price is required').max(10_000_00),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.serviceType === 'transfer' && (data.dropoffAddress ?? '').trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dropoffAddress'],
        message: 'Destination is required for a transfer',
      });
    }
  });

export type EditBookingInput = z.infer<typeof editBookingSchema>;

export interface EditBookingDeps {
  db: Database;
  clock?: Clock;
  mirror?: SpreadsheetMirrorPort;
}

export type EditBookingResult =
  | { ok: true; booking: Booking; changedFields: string[] }
  | { ok: false; reason: 'validation'; issues: z.ZodIssue[] }
  | { ok: false; reason: 'booking_not_found' }
  | { ok: false; reason: 'not_editable'; state: string };

// Booking details may only be amended before the trip is closed out. Once a
// booking is completed or cancelled it is immutable — those are terminal,
// billing-relevant states.
const TERMINAL_STATES = new Set(['completed', 'cancelled']);

/**
 * Amend the operator-captured details of a booking (trip, passenger, caller,
 * price, notes) without changing its workflow state. Returns the list of
 * human-readable fields that actually changed, records an audit event, and
 * mirrors to the spreadsheet. A no-op edit (nothing changed) writes neither.
 */
export async function editBooking(
  raw: unknown,
  operatorId: string,
  deps: EditBookingDeps,
): Promise<EditBookingResult> {
  const parsed = editBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', issues: parsed.error.issues };
  }
  const data = parsed.data;

  const [existing] = await deps.db
    .select()
    .from(bookings)
    .where(eq(bookings.id, data.bookingId))
    .limit(1);
  if (!existing) return { ok: false, reason: 'booking_not_found' };
  if (TERMINAL_STATES.has(existing.state)) {
    return { ok: false, reason: 'not_editable', state: existing.state };
  }

  const lastName = data.passengerLastName ?? null;
  const notes = data.notes ?? null;
  // Hourly hire has no destination or route distance; a transfer keeps both.
  const isHourly = data.serviceType === 'hourly';
  const dropoffAddress = isHourly ? null : (data.dropoffAddress ?? null);
  const distanceMeters = isHourly ? null : (data.distanceMeters ?? null);

  const changedFields = diffFields(existing, {
    ...data,
    dropoffAddress,
    distanceMeters,
    passengerLastName: lastName,
    notes,
  });

  // Nothing changed — return the booking untouched, no audit, no mirror.
  if (changedFields.length === 0) {
    return { ok: true, booking: existing, changedFields };
  }

  const now = (deps.clock ?? systemClock).now();
  const [updated] = await deps.db
    .update(bookings)
    .set({
      serviceType: data.serviceType,
      pickupAt: data.pickupAt,
      expectedDurationMinutes: data.expectedDurationMinutes,
      distanceMeters,
      pickupAddress: data.pickupAddress,
      dropoffAddress,
      passengerFirstName: data.passengerFirstName,
      passengerLastName: lastName,
      execMobile: data.execMobile,
      clientName: data.customerAccount,
      accountCode: data.customerAccount,
      caseCode: data.caseCode,
      contractPricePence: data.contractPricePence,
      notes,
      updatedAt: now,
    })
    .where(and(eq(bookings.id, data.bookingId), eq(bookings.state, existing.state)))
    .returning();
  if (!updated) {
    return { ok: false, reason: 'not_editable', state: existing.state };
  }

  await recordAuditEvent(deps.db, {
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: data.bookingId,
    action: 'edit',
    before: null,
    after: { changedFields },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, updated);

  return { ok: true, booking: updated, changedFields };
}

type EditableFields = Omit<EditBookingInput, 'bookingId' | 'dropoffAddress' | 'distanceMeters'> & {
  dropoffAddress: string | null;
  distanceMeters: number | null;
  passengerLastName: string | null;
  notes: string | null;
};

function diffFields(existing: Booking, next: EditableFields): string[] {
  const out: string[] = [];
  if (existing.serviceType !== next.serviceType) out.push('service type');
  if (existing.pickupAt.getTime() !== next.pickupAt.getTime()) out.push('pickup time');
  if (existing.expectedDurationMinutes !== next.expectedDurationMinutes) out.push('duration');
  if (existing.pickupAddress !== next.pickupAddress) out.push('pickup address');
  if ((existing.dropoffAddress ?? null) !== next.dropoffAddress) out.push('drop-off');
  if (
    existing.passengerFirstName !== next.passengerFirstName ||
    (existing.passengerLastName ?? null) !== next.passengerLastName
  ) {
    out.push('passenger name');
  }
  if (existing.execMobile !== next.execMobile) out.push('exec mobile');
  // Customer Account is held in account_code (client_name mirrors it).
  if (existing.accountCode !== next.customerAccount) out.push('customer account');
  if ((existing.caseCode ?? null) !== next.caseCode) out.push('case code');
  if (existing.contractPricePence !== next.contractPricePence) out.push('price');
  if ((existing.notes ?? null) !== next.notes) out.push('notes');
  return out;
}
