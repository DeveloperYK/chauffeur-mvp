import type { Database } from '@/server/db';
import { type Booking, bookings } from '@/server/db/schema';
import type { Clock } from '@/server/ports/clock';
import { systemClock } from '@/server/ports/clock';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
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
    pickupAt: z.coerce.date(),
    expectedDurationMinutes: z.coerce.number().int().min(15).max(720),
    pickupAddress: z.string().min(3).max(500),
    dropoffAddress: z.string().min(3).max(500),
    passengerFirstName: z.string().min(1).max(80),
    passengerLastName: z.string().min(1).max(80),
    execMobile: phoneSchema,
    accountCode: z.string().min(1).max(40),
    contractPricePence: z.coerce.number().int().min(0).max(10_000_00),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

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
  | { ok: false; reason: 'pickup_in_past' };

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

  const [inserted] = await deps.db
    .insert(bookings)
    .values({
      pickupAt: parsed.data.pickupAt,
      expectedDurationMinutes: parsed.data.expectedDurationMinutes,
      pickupAddress: parsed.data.pickupAddress,
      dropoffAddress: parsed.data.dropoffAddress,
      passengerFirstName: parsed.data.passengerFirstName,
      passengerLastName: parsed.data.passengerLastName,
      execMobile: parsed.data.execMobile,
      accountCode: parsed.data.accountCode,
      contractPricePence: parsed.data.contractPricePence,
      notes: parsed.data.notes ?? null,
      // The operator who creates the ticket is its "booked by" and its
      // initial assignee (Jira-style — reassignable later).
      createdByOperatorId: deps.operatorId,
      assignedOperatorId: deps.operatorId,
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
    after: { state: inserted.state },
  });

  if (deps.mirror) await mirrorBooking(deps.db, deps.mirror, inserted);

  return { ok: true, booking: inserted };
}
