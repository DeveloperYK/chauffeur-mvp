import { hashPassword } from '@/server/auth/password';
import type { Database } from '@/server/db';
import {
  type BookingState,
  auditEvents,
  bookings,
  consumedTokens,
  drivers,
} from '@/server/db/schema';
import { operators } from '@/server/db/schema';
import type { NotificationPort } from '@/server/ports/notifications';
import { eq, sql } from 'drizzle-orm';
import { createBooking } from './bookings';
import { buildExecContextForBooking, sendExecNotification } from './exec-notifications';

const SAMPLE_DRIVERS = [
  {
    name: 'Tom Wright',
    vehicleClass: 'executive',
    car: 'Mercedes S-Class',
    carColour: 'Black',
    whatsappNumber: '+447911100001',
  },
  {
    name: 'Andy Patel',
    vehicleClass: 'luxury',
    car: 'BMW 7 Series',
    carColour: 'Black',
    whatsappNumber: '+447911100002',
  },
  {
    name: 'Mario Rossi',
    vehicleClass: 'executive',
    car: 'Mercedes E-Class',
    carColour: 'Grey',
    whatsappNumber: '+447911100003',
  },
  {
    name: 'Alex Mercier',
    vehicleClass: 'mpv',
    car: 'Mercedes V-Class',
    carColour: 'Silver',
    whatsappNumber: '+447911100004',
  },
  {
    name: 'Yuki Tanaka',
    vehicleClass: 'coach',
    car: 'Mercedes Sprinter',
    carColour: 'Black',
    whatsappNumber: '+447911100005',
  },
] as const;

const SAMPLE_BOOKINGS = [
  {
    pickupOffsetHours: 26,
    duration: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4JJ',
    dropoffAddress: 'London Heathrow Airport, Terminal 5',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911123456',
    customerAccount: 'LEGO Group',
    caseCode: 'LEGO-2026-001',
    contractPricePence: 30000,
  },
  {
    pickupOffsetHours: 30,
    duration: 60,
    pickupAddress: '1 Goddard Place, London N19 5GT',
    dropoffAddress: 'London Heathrow Airport, Terminal 4',
    passengerFirstName: 'Martin',
    passengerLastName: 'Finch',
    execMobile: '+447400123456',
    customerAccount: 'Mercedes-Benz UK',
    caseCode: 'MERC-2026-014',
    contractPricePence: 20000,
  },
  {
    pickupOffsetHours: 48,
    duration: 120,
    pickupAddress: 'The Shard, London SE1 9SG',
    dropoffAddress: 'Cambridge, UK',
    passengerFirstName: 'Sophia',
    passengerLastName: 'Lefevre',
    execMobile: '+33612345678',
    customerAccount: 'Johnson & Johnson',
    caseCode: 'JJ-2026-220',
    contractPricePence: 45000,
  },
] as const;

const SAMPLE_OPERATORS = [
  { name: 'Priya Shah', email: 'priya@example.com' },
  { name: 'Marcus Bell', email: 'marcus@example.com' },
] as const;

export interface SimulatorReport {
  driversCreated: number;
  bookingsCreated: number;
  operatorsCreated: number;
}

export async function seedSampleData(db: Database, operatorId: string): Promise<SimulatorReport> {
  let driversCreated = 0;
  let bookingsCreated = 0;
  let operatorsCreated = 0;
  const now = Date.now();

  // A couple of extra operators so assignment + filtering is demoable.
  for (const o of SAMPLE_OPERATORS) {
    const existing = await db
      .select()
      .from(operators)
      .where(sql`lower(${operators.email}) = ${o.email}`)
      .limit(1);
    if (existing.length > 0) continue;
    const passwordHash = await hashPassword('demo-password-long-12');
    await db.insert(operators).values({ name: o.name, email: o.email, passwordHash });
    operatorsCreated++;
  }

  for (const d of SAMPLE_DRIVERS) {
    const existing = await db
      .select()
      .from(drivers)
      .where(eq(drivers.whatsappNumber, d.whatsappNumber))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(drivers).values({ ...d });
    driversCreated++;
  }

  for (const b of SAMPLE_BOOKINGS) {
    const pickupAt = new Date(now + b.pickupOffsetHours * 60 * 60 * 1000);
    const result = await createBooking(
      {
        pickupAt: pickupAt.toISOString(),
        expectedDurationMinutes: b.duration,
        pickupAddress: b.pickupAddress,
        dropoffAddress: b.dropoffAddress,
        passengerFirstName: b.passengerFirstName,
        passengerLastName: b.passengerLastName,
        execMobile: b.execMobile,
        customerAccount: b.customerAccount,
        caseCode: b.caseCode,
        contractPricePence: b.contractPricePence,
      },
      { db, operatorId },
    );
    if (result.ok) bookingsCreated++;
  }

  return { driversCreated, bookingsCreated, operatorsCreated };
}

export async function resetAllData(db: Database): Promise<void> {
  // Order matters because of FKs.
  await db.delete(auditEvents);
  await db.delete(consumedTokens);
  await db.delete(bookings);
  await db.delete(drivers);
}

/**
 * Shift a booking's `pickup_at` so that the clock-tick service treats it as
 * eligible for the next time-based transition. Use to demo:
 *   - assigned → in_progress (set pickup to now + 30min)
 *   - in_progress → awaiting_driver_form (set pickup to now - duration)
 *   - 24h no-accept flag (set created_at to 25 hours ago)
 */
export async function fastForwardBooking(
  db: Database,
  bookingId: string,
  scenario: 'about_to_start' | 'trip_finished' | 'aged_unaccepted',
): Promise<void> {
  const now = new Date();

  if (scenario === 'about_to_start') {
    const pickup = new Date(now.getTime() + 30 * 60 * 1000); // 30 min in future
    await db
      .update(bookings)
      .set({ pickupAt: pickup, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    return;
  }

  if (scenario === 'trip_finished') {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    if (!b) return;
    // pickup 2h ago and duration matches → expected_end is in the past
    const pickup = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    await db
      .update(bookings)
      .set({ pickupAt: pickup, updatedAt: now })
      .where(eq(bookings.id, bookingId));
    return;
  }

  if (scenario === 'aged_unaccepted') {
    await db
      .update(bookings)
      .set({
        createdAt: new Date(now.getTime() - 25 * 60 * 60 * 1000),
        flaggedAt: null,
        updatedAt: now,
      })
      .where(eq(bookings.id, bookingId));
    return;
  }
}

/**
 * Force a booking into a target state, populating only the safe columns so
 * other timers/services keep working. Bypasses the state machine — for demo
 * use only.
 */
export async function setBookingState(
  db: Database,
  bookingId: string,
  state: BookingState,
  operatorId: string,
): Promise<void> {
  const now = new Date();
  const [existing] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!existing) return;

  const patch: Record<string, unknown> = { state, updatedAt: now };

  // Pick an active driver if we're advancing past unassigned and none is set.
  if (state !== 'unassigned' && !existing.assignedDriverId) {
    const [d] = await db.select().from(drivers).where(eq(drivers.active, true)).limit(1);
    if (d) {
      patch.assignedDriverId = d.id;
      patch.assignedAt = now;
    }
  }

  if (state === 'completed') {
    patch.approvedAt = now;
    patch.approvedByOperatorId = operatorId;
    patch.completionSubmittedAt = now;
    if (!existing.carParkPence) patch.carParkPence = 0;
    if (!existing.waitingTimeMinutes) patch.waitingTimeMinutes = 0;
    if (!existing.dropoffAt) patch.dropoffAt = now;
  }
  if (state === 'cancelled') {
    patch.cancelledAt = now;
    patch.cancelledByOperatorId = operatorId;
    patch.cancellationReason = 'simulator';
  }
  if (state === 'awaiting_operator_review') {
    patch.completionSubmittedAt = now;
    if (!existing.carParkPence) patch.carParkPence = 500;
    if (!existing.waitingTimeMinutes) patch.waitingTimeMinutes = 10;
    if (!existing.dropoffAt) patch.dropoffAt = now;
  }

  await db.update(bookings).set(patch).where(eq(bookings.id, bookingId));

  await db.insert(auditEvents).values({
    actorType: 'operator',
    actorId: operatorId,
    entityType: 'booking',
    entityId: bookingId,
    action: 'simulator_force_state',
    before: { state: existing.state },
    after: { state },
  });
}

export interface BookingSummary {
  id: string;
  state: BookingState;
  clientName: string;
  passengerName: string;
  pickupAt: Date;
  accountCode: string;
}

export async function listAllForSimulator(db: Database): Promise<BookingSummary[]> {
  const rows = await db.select().from(bookings).orderBy(sql`${bookings.createdAt} desc`).limit(50);
  return rows.map((b) => ({
    id: b.id,
    state: b.state,
    clientName: b.clientName,
    passengerName: `${b.passengerFirstName}${b.passengerLastName ? ` ${b.passengerLastName}` : ''}`,
    pickupAt: b.pickupAt,
    accountCode: b.accountCode,
  }));
}

/**
 * Force a failed exec confirmation message on a booking, so operators (and the
 * lifecycle e2e) can exercise the silent-failure surfaces — red tile, panel
 * indicator, drawer error, and one-click resend — without a real provider
 * outage. Goes through the real send path with a notifier that always rejects,
 * so a genuine `failed` row is written and the cached status flips to `failed`.
 */
export async function simulateExecMessageFailure(db: Database, bookingId: string): Promise<void> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) return;
  const ctx = await buildExecContextForBooking(db, booking, 'assigned');
  if (!ctx) return;
  const failing: NotificationPort = {
    async sendSms() {
      return { ok: false, reason: 'simulated_failure' };
    },
  };
  await sendExecNotification({ db, notifications: failing }, ctx);
}

export async function ensureDemoOperator(db: Database): Promise<{ id: string }> {
  const email = 'demo@example.com';
  const existing = await db
    .select()
    .from(operators)
    .where(sql`lower(${operators.email}) = ${email}`)
    .limit(1);
  if (existing[0]) return { id: existing[0].id };
  const passwordHash = await hashPassword('demo-password-long-12');
  const [op] = await db
    .insert(operators)
    .values({ email, passwordHash, name: 'Demo Operator' })
    .returning();
  if (!op) throw new Error('failed to seed demo operator');
  return { id: op.id };
}
