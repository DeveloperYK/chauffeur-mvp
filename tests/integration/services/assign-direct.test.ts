import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import {
  type BookingState,
  auditEvents,
  bookings,
  dispatchOffers,
  drivers,
  operators,
} from '@/server/db/schema';
import {
  acceptDispatchLink,
  assignDriverDirect,
  generateDispatchLink,
} from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-assign-direct-secret-must-be-32-chars-long-ok';
const APP_URL = 'https://example.test';

describe('services/dispatch — assignDriverDirect (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverA: { id: string; whatsapp: string };
  let driverB: { id: string; whatsapp: string };
  let notifications: FakeNotificationAdapter;
  let mirror: FakeSpreadsheetMirror;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' })
      .returning();
    operatorId = op?.id ?? '';
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(auditEvents);
    await db.delete(dispatchOffers);
    await db.delete(bookings);
    await db.delete(drivers);
    notifications = new FakeNotificationAdapter();
    mirror = new FakeSpreadsheetMirror();

    const [a] = await db
      .insert(drivers)
      .values({
        name: 'Tom A',
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverA = { id: a?.id ?? '', whatsapp: a?.whatsappNumber ?? '' };
    const [b] = await db
      .insert(drivers)
      .values({
        name: 'Bea B',
        vehicleClass: 'luxury',
        car: 'BMW 7 Series',
        carColour: 'Blue',
        whatsappNumber: '+447911000002',
      })
      .returning();
    driverB = { id: b?.id ?? '', whatsapp: b?.whatsappNumber ?? '' };
  });

  const EXEC = '+447911999999';

  async function seed(state: BookingState, assignedDriverId: string | null = null) {
    const [row] = await db
      .insert(bookings)
      .values({
        state,
        pickupAt: new Date('2099-06-01T10:00:00.000Z'),
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens, London',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: EXEC,
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId,
        assignmentMethod: assignedDriverId ? 'driver_self' : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  const deps = () => ({
    db,
    notifications,
    secret: SECRET,
    appUrl: APP_URL,
    mirror,
  });

  // ── Initial assign (unassigned → assigned) ────────────────────────────────
  it('assigns a driver directly from unassigned and confirms the exec, not the driver', async () => {
    const booking = await seed('unassigned');
    const res = await assignDriverDirect(booking.id, driverB.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.swapped).toBe(false);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.state).toBe('assigned');
    expect(row?.assignedDriverId).toBe(driverB.id);
    expect(row?.assignmentMethod).toBe('operator_attested');

    // Exec confirmed; the newly-assigned driver is NOT messaged.
    expect(notifications.sent.some((m) => m.to === EXEC)).toBe(true);
    expect(notifications.sent.some((m) => m.to === driverB.whatsapp)).toBe(false);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, booking.id));
    expect(audits.some((a) => a.action === 'operator_assign')).toBe(true);
  });

  it('lapses an outstanding open offer when assigning directly', async () => {
    const booking = await seed('unassigned');
    await db.insert(dispatchOffers).values({
      bookingId: booking.id,
      driverId: driverA.id,
      jti: 'jti-open-1',
      status: 'open',
    });
    await assignDriverDirect(booking.id, driverB.id, operatorId, deps());
    const [offer] = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.jti, 'jti-open-1'));
    expect(offer?.status).toBe('lapsed');
  });

  it('rejects an inactive driver', async () => {
    await db.update(drivers).set({ active: false }).where(eq(drivers.id, driverB.id));
    const booking = await seed('unassigned');
    const res = await assignDriverDirect(booking.id, driverB.id, operatorId, deps());
    expect(res).toMatchObject({ ok: false, reason: 'driver_inactive' });
  });

  it('rejects an unknown driver and unknown booking', async () => {
    const booking = await seed('unassigned');
    expect(
      await assignDriverDirect(
        booking.id,
        '00000000-0000-0000-0000-0000000000ff',
        operatorId,
        deps(),
      ),
    ).toMatchObject({ ok: false, reason: 'driver_not_found' });
    expect(
      await assignDriverDirect(
        '00000000-0000-0000-0000-0000000000ff',
        driverB.id,
        operatorId,
        deps(),
      ),
    ).toMatchObject({ ok: false, reason: 'booking_not_found' });
  });

  it('refuses to assign past assigned (e.g. completed)', async () => {
    const booking = await seed('completed', driverA.id);
    const res = await assignDriverDirect(booking.id, driverB.id, operatorId, deps());
    expect(res).toMatchObject({ ok: false, reason: 'wrong_state', state: 'completed' });
  });

  // ── Swap (assigned → assigned, different driver) ──────────────────────────
  it('swaps the assigned driver, drops the old one, and re-confirms the exec', async () => {
    const booking = await seed('assigned', driverA.id);
    const res = await assignDriverDirect(booking.id, driverB.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.swapped).toBe(true);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.assignedDriverId).toBe(driverB.id);
    expect(row?.assignmentMethod).toBe('operator_attested');

    // Old driver A told they're off; exec re-confirmed; new driver B not messaged.
    expect(notifications.sent.some((m) => m.to === driverA.whatsapp)).toBe(true);
    expect(notifications.sent.some((m) => m.to === EXEC)).toBe(true);
    expect(notifications.sent.some((m) => m.to === driverB.whatsapp)).toBe(false);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, booking.id));
    expect(audits.some((a) => a.action === 'operator_swap')).toBe(true);
  });

  it('rejects swapping to the same driver', async () => {
    const booking = await seed('assigned', driverA.id);
    const res = await assignDriverDirect(booking.id, driverA.id, operatorId, deps());
    expect(res).toMatchObject({ ok: false, reason: 'same_driver' });
  });

  // ── acceptDispatchLink records driver_self ────────────────────────────────
  it('a link-accept records assignmentMethod = driver_self', async () => {
    const booking = await seed('unassigned');
    const link = await generateDispatchLink(booking.id, driverA.id, operatorId, deps());
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const token = link.url.split('/j/')[1] ?? '';
    const accept = await acceptDispatchLink({ token }, deps());
    expect(accept.ok).toBe(true);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.assignmentMethod).toBe('driver_self');
  });
});
