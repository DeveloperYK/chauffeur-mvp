import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { auditEvents, bookings, drivers, operators } from '@/server/db/schema';
import { fixedClock } from '@/server/ports/clock';
import { createBooking } from '@/server/services/bookings';
import { cancelBooking } from '@/server/services/cancel';
import { acceptDispatchLink, generateDispatchLink } from '@/server/services/dispatch';
import { retryMirror } from '@/server/services/mirror';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'mirror-status-test-secret-at-least-32-characters-long';
const APP_URL = 'https://example.test';

const brokenMirror = () => ({
  upsertRow: async () => ({ ok: false as const, reason: 'simulated' }),
  deleteRow: async () => ({ ok: false as const, reason: 'simulated' }),
});

const throwingMirror = () => ({
  upsertRow: async (): Promise<{ ok: true }> => {
    throw new Error('boom');
  },
  deleteRow: async (): Promise<{ ok: true }> => {
    throw new Error('boom');
  },
});

describe('mirror write status on bookings', () => {
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

  const createInput = {
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
  };

  async function loadBooking(id: string) {
    const [b] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!b) throw new Error('booking not found');
    return b;
  }

  async function createWith(mirror?: Parameters<typeof createBooking>[1]['mirror']) {
    const clock = fixedClock('2026-05-18T10:00:00.000Z');
    const r = await createBooking(
      createInput,
      mirror ? { db, operatorId, mirror, clock } : { db, operatorId, clock },
    );
    if (!r.ok) throw new Error('create failed');
    return r.booking;
  }

  // ── happy paths ─────────────────────────────────────────────────────────────

  it('successful mirror write marks the booking ok with a timestamp', async () => {
    const created = await createWith(new FakeSpreadsheetMirror());
    const b = await loadBooking(created.id);
    expect(b.mirrorStatus).toBe('ok');
    expect(b.mirroredAt).toBeInstanceOf(Date);
  });

  it('a later successful write self-heals a failed status', async () => {
    const created = await createWith(brokenMirror());
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');

    // Next real mirror write (driver accepting the dispatch link) succeeds.
    const mirror = new FakeSpreadsheetMirror();
    const notifications = new FakeNotificationAdapter();
    const clock = fixedClock('2026-05-18T10:00:00.000Z');
    const gen = await generateDispatchLink(created.id, driverId, operatorId, {
      db,
      notifications,
      secret: SECRET,
      appUrl: APP_URL,
      clock,
      mirror,
    });
    if (!gen.ok) throw new Error('gen failed');
    const token = new URL(gen.url).pathname.split('/').pop() ?? '';
    await acceptDispatchLink(
      { token },
      { db, notifications, secret: SECRET, appUrl: APP_URL, clock, mirror },
    );

    expect((await loadBooking(created.id)).mirrorStatus).toBe('ok');
  });

  it('successful row removal on cancel marks the booking ok', async () => {
    const mirror = new FakeSpreadsheetMirror();
    const created = await createWith(mirror);
    const r = await cancelBooking(
      { bookingId: created.id, reason: 'client cancelled' },
      operatorId,
      {
        db,
        mirror,
        clock: fixedClock('2026-05-18T11:00:00.000Z'),
      },
    );
    expect(r.ok).toBe(true);
    const b = await loadBooking(created.id);
    expect(b.mirrorStatus).toBe('ok');
    expect(mirror.rows.has(created.id)).toBe(false);
  });

  it('retryMirror re-writes the row and clears a failed status', async () => {
    const created = await createWith(brokenMirror());
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');

    const mirror = new FakeSpreadsheetMirror();
    const r = await retryMirror({ db, mirror, operatorId }, created.id);
    expect(r).toEqual({ ok: true, status: 'ok' });
    expect(mirror.rows.has(created.id)).toBe(true);
    expect((await loadBooking(created.id)).mirrorStatus).toBe('ok');
  });

  it('retryMirror on a cancelled booking re-runs the row removal', async () => {
    const created = await createWith(new FakeSpreadsheetMirror());
    const cancel = await cancelBooking(
      { bookingId: created.id, reason: 'client cancelled' },
      operatorId,
      { db, mirror: brokenMirror(), clock: fixedClock('2026-05-18T11:00:00.000Z') },
    );
    expect(cancel.ok).toBe(true);
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');

    // The retry must DELETE the lingering row, not resurrect it as an upsert.
    const mirror = new FakeSpreadsheetMirror();
    await mirror.upsertRow({ booking: created, driver: null, operator: null });
    const r = await retryMirror({ db, mirror, operatorId }, created.id);
    expect(r).toEqual({ ok: true, status: 'ok' });
    expect(mirror.rows.has(created.id)).toBe(false);
    expect((await loadBooking(created.id)).mirrorStatus).toBe('ok');
  });

  it('retryMirror records an audit event', async () => {
    const created = await createWith(brokenMirror());
    await retryMirror({ db, mirror: new FakeSpreadsheetMirror(), operatorId }, created.id);
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'mirror_retry'));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorId).toBe(operatorId);
    expect(events[0]?.entityId).toBe(created.id);
  });

  // ── unhappy paths ───────────────────────────────────────────────────────────

  it('a rejected mirror write marks the booking failed', async () => {
    const created = await createWith(brokenMirror());
    const b = await loadBooking(created.id);
    expect(b.mirrorStatus).toBe('failed');
    expect(b.mirroredAt).toBeInstanceOf(Date);
  });

  it('a throwing mirror write marks the booking failed', async () => {
    const created = await createWith(throwingMirror());
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');
  });

  it('a failed row removal on cancel marks the booking failed', async () => {
    const created = await createWith(new FakeSpreadsheetMirror());
    const r = await cancelBooking(
      { bookingId: created.id, reason: 'client cancelled' },
      operatorId,
      { db, mirror: brokenMirror(), clock: fixedClock('2026-05-18T11:00:00.000Z') },
    );
    expect(r.ok).toBe(true);
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');
  });

  it('no mirror configured leaves the status none', async () => {
    const created = await createWith();
    const b = await loadBooking(created.id);
    expect(b.mirrorStatus).toBe('none');
    expect(b.mirroredAt).toBeNull();
  });

  it('retryMirror on an unknown booking returns booking_not_found', async () => {
    const r = await retryMirror(
      { db, mirror: new FakeSpreadsheetMirror(), operatorId },
      '00000000-0000-0000-0000-000000000000',
    );
    expect(r).toEqual({ ok: false, reason: 'booking_not_found' });
  });

  it('retryMirror against a still-broken mirror reports failed and keeps the flag', async () => {
    const created = await createWith(brokenMirror());
    const r = await retryMirror({ db, mirror: brokenMirror(), operatorId }, created.id);
    expect(r).toEqual({ ok: true, status: 'failed' });
    expect((await loadBooking(created.id)).mirrorStatus).toBe('failed');
  });
});
