import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { createBooking } from '@/server/services/bookings';
import {
  approveBooking,
  generateCompletionLink,
  submitCompletionForm,
} from '@/server/services/completion';
import { acceptDispatchLink, generateDispatchLink } from '@/server/services/dispatch';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'mirror-test-secret-must-be-at-least-32-characters-long';
const APP_URL = 'https://example.test';

describe('spreadsheet mirror integration', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverId: string;

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
    await db.delete(bookings);
    await db.delete(drivers);
    const [drv] = await db
      .insert(drivers)
      .values({
        name: 'Tom',
        vehicleClass: 'executive',
        car: 'Mercedes S-Class',
        carColour: 'Black',
        whatsappNumber: '+447911000001',
      })
      .returning();
    driverId = drv?.id ?? '';
  });

  it('createBooking writes a row to the mirror', async () => {
    const mirror = new FakeSpreadsheetMirror();
    const clock = fixedClock('2026-05-18T10:00:00.000Z');
    const r = await createBooking(
      {
        pickupAt: '2026-06-01T10:00:00.000Z',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        customerAccount: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        notes: null,
      },
      { db, operatorId, mirror, clock },
    );
    expect(r.ok).toBe(true);
    expect(mirror.rows.size).toBe(1);
  });

  it('full lifecycle hits mirror on create, accept, submit, approve', async () => {
    const mirror = new FakeSpreadsheetMirror();
    const notifications = new FakeNotificationAdapter();
    const clock = fixedClock('2026-05-18T10:00:00.000Z');

    const create = await createBooking(
      {
        pickupAt: '2026-06-01T10:00:00.000Z',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        customerAccount: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        notes: null,
      },
      { db, operatorId, mirror, clock },
    );
    if (!create.ok) throw new Error('create');
    const bookingId = create.booking.id;

    // accept
    const gen = await generateDispatchLink(bookingId, driverId, operatorId, {
      db,
      notifications,
      secret: SECRET,
      appUrl: APP_URL,
      clock,
      mirror,
    });
    if (!gen.ok) throw new Error('gen');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await acceptDispatchLink(
      { token },
      { db, notifications, secret: SECRET, appUrl: APP_URL, clock, mirror },
    );

    // simulate clock has advanced past expected end so we can submit
    await db
      .update(bookings)
      .set({ state: 'awaiting_driver_form' })
      .where(eq(bookings.id, bookingId));

    const completionGen = await generateCompletionLink(bookingId, operatorId, {
      db,
      secret: SECRET,
      appUrl: APP_URL,
      clock,
      mirror,
    });
    if (!completionGen.ok) throw new Error('completion gen');
    const completionToken = new URL(completionGen.url).pathname.split('/').pop() ?? '';

    await submitCompletionForm(
      {
        token: completionToken,
        carParkPence: 750,
        arrivalTime: '10:50',
        passengerOnBoardTime: '11:02',
        completionTime: '12:25',
      },
      { db, secret: SECRET, appUrl: APP_URL, clock, mirror },
    );

    await approveBooking(bookingId, operatorId, {
      db,
      secret: SECRET,
      appUrl: APP_URL,
      clock,
      mirror,
    });

    // mirror.rows is keyed by booking.id; multiple upserts overwrite.
    const finalRow = mirror.rows.get(bookingId);
    expect(finalRow).toBeDefined();
    expect(finalRow?.[11]).toBe('300.00'); // contract price (L)
    expect(finalRow?.[15]).toBe('7.50'); // car park (P)
    expect(finalRow?.[17]).toMatch(/^\d{2}:\d{2}$/); // drop-off time (R), London hh:mm
    expect(finalRow?.[12]).toBe('Tom'); // driver name (M)
  });

  it('mirror failure does not break the operation', async () => {
    const brokenMirror = {
      upsertRow: async () => ({ ok: false as const, reason: 'simulated' }),
    };
    const clock = fixedClock('2026-05-18T10:00:00.000Z');
    const r = await createBooking(
      {
        pickupAt: '2026-06-01T10:00:00.000Z',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        customerAccount: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        notes: null,
      },
      { db, operatorId, mirror: brokenMirror, clock },
    );
    expect(r.ok).toBe(true);
  });

  it('mirror thrown error is caught (still ok)', async () => {
    const throwingMirror = {
      upsertRow: async () => {
        throw new Error('boom');
      },
    };
    const clock = fixedClock('2026-05-18T10:00:00.000Z');
    const r = await createBooking(
      {
        pickupAt: '2026-06-01T10:00:00.000Z',
        expectedDurationMinutes: 90,
        pickupAddress: '11 Belsize Park Gardens',
        dropoffAddress: 'LHR Terminal 5',
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        execMobile: '+447911123456',
        customerAccount: 'LEGO Group',
        caseCode: 'LEGO-2026-001',
        contractPricePence: 30000,
        notes: null,
      },
      { db, operatorId, mirror: throwingMirror, clock },
    );
    expect(r.ok).toBe(true);
  });
});
