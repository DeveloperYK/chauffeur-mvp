import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import {
  type BookingState,
  auditEvents,
  bookings,
  dispatchOffers,
  drivers,
  operators,
} from '@/server/db/schema';
import { previewDriverJob } from '@/server/services/dispatch';
import { generateDriverJobLink } from '@/server/services/driver-job-link';
import { resolveShortLink } from '@/server/services/short-links';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = 'test-driver-job-link-secret-must-be-32-chars-ok';
const APP_URL = 'https://example.test/';

describe('services/driver-job-link — generateDriverJobLink (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driverA: { id: string; whatsapp: string };
  let driverB: { id: string; whatsapp: string };

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
        vehicleClass: 'vip',
        car: 'BMW 7 Series',
        carColour: 'Blue',
        whatsappNumber: '+447911000002',
      })
      .returning();
    driverB = { id: b?.id ?? '', whatsapp: b?.whatsappNumber ?? '' };
  });

  async function seed(
    state: BookingState,
    opts: {
      assignedDriverId?: string | null;
      method?: 'driver_self' | 'operator_attested';
    } = {},
  ) {
    const assignedDriverId = opts.assignedDriverId ?? null;
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
        execMobile: '+447911999999',
        clientName: 'LEGO Group',
        accountCode: 'LEGO Group',
        contractPricePence: 30000,
        createdByOperatorId: operatorId,
        assignedOperatorId: operatorId,
        assignedDriverId,
        assignmentMethod: assignedDriverId ? (opts.method ?? 'operator_attested') : null,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  const deps = () => ({ db, secret: SECRET, appUrl: APP_URL, mirror: new FakeSpreadsheetMirror() });

  // ── Happy paths ───────────────────────────────────────────────────────────
  it('mints a job link for a phone-assigned driver that opens their job view', async () => {
    const booking = await seed('assigned', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.driver.id).toBe(driverA.id);
    expect(res.booking.id).toBe(booking.id);
    expect(res.url.startsWith('https://example.test/j/')).toBe(true);
    expect(res.url).not.toContain('//j/');

    const token = res.url.slice('https://example.test/j/'.length);
    const job = await previewDriverJob(token, { db, secret: SECRET, appUrl: APP_URL });
    expect(job.ok).toBe(true);
    if (!job.ok) return;
    expect(job.booking.id).toBe(booking.id);
    expect(job.driver.id).toBe(driverA.id);
  });

  it('mints a job link for a link-accepted (driver_self) driver too', async () => {
    const booking = await seed('assigned', { assignedDriverId: driverB.id, method: 'driver_self' });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.driver.id).toBe(driverB.id);
  });

  it('mints a job link while the trip is in progress', async () => {
    const booking = await seed('in_progress', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const token = res.url.slice('https://example.test/j/'.length);
    const job = await previewDriverJob(token, { db, secret: SECRET, appUrl: APP_URL });
    expect(job.ok).toBe(true);
  });

  it('builds a branded short link and a WhatsApp message carrying it, to the driver', async () => {
    const booking = await seed('assigned', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.shortUrl).toMatch(/^https:\/\/example\.test\/s\/[A-Za-z0-9]+$/);
    const code = res.shortUrl.slice('https://example.test/s/'.length);
    expect(await resolveShortLink(db, code)).toBe(res.url);

    expect(res.message).toContain('Your job BKNG-');
    expect(res.message).toContain(`Details: ${res.shortUrl}`);
    expect(res.message).not.toContain('Accept');
    expect(res.whatsappUrl).toContain(encodeURIComponent(res.shortUrl));
    expect(res.whatsappUrl).toContain(driverA.whatsapp.replace('+', ''));
  });

  it('records an audit event and does NOT open a dispatch offer', async () => {
    const booking = await seed('assigned', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, booking.id));
    const row = audits.find((a) => a.action === 'driver_job_link_generated');
    expect(row).toBeDefined();
    expect(row?.actorType).toBe('operator');
    expect(row?.actorId).toBe(operatorId);
    expect((row?.after as { driverId?: string }).driverId).toBe(driverA.id);

    const offers = await db
      .select()
      .from(dispatchOffers)
      .where(eq(dispatchOffers.bookingId, booking.id));
    expect(offers).toHaveLength(0);
  });

  // ── Unhappy paths ─────────────────────────────────────────────────────────
  it('rejects an unknown booking', async () => {
    const res = await generateDriverJobLink(
      '00000000-0000-0000-0000-000000000000',
      operatorId,
      deps(),
    );
    expect(res).toEqual({ ok: false, reason: 'booking_not_found' });
  });

  it('rejects an unassigned booking (nothing to give the driver yet)', async () => {
    const booking = await seed('unassigned');
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res).toEqual({ ok: false, reason: 'wrong_state', state: 'unassigned' });
  });

  it('rejects a booking that is past the trip (completion link is the right tool)', async () => {
    for (const state of [
      'awaiting_driver_form',
      'awaiting_operator_review',
      'completed',
    ] as const) {
      const booking = await seed(state, { assignedDriverId: driverA.id });
      const res = await generateDriverJobLink(booking.id, operatorId, deps());
      expect(res).toEqual({ ok: false, reason: 'wrong_state', state });
    }
  });

  it('rejects a cancelled booking', async () => {
    const booking = await seed('cancelled', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res).toEqual({ ok: false, reason: 'wrong_state', state: 'cancelled' });
  });

  it('rejects a bad secret (link verification is the security boundary)', async () => {
    const booking = await seed('assigned', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const token = res.url.slice('https://example.test/j/'.length);
    const job = await previewDriverJob(token, {
      db,
      secret: 'another-secret-that-is-also-32-chars-long-xx',
      appUrl: APP_URL,
    });
    expect(job).toEqual({ ok: false, reason: 'token_invalid' });
  });

  it("a previous driver's job link goes dead once the job is swapped to someone else", async () => {
    const booking = await seed('assigned', { assignedDriverId: driverA.id });
    const res = await generateDriverJobLink(booking.id, operatorId, deps());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const token = res.url.slice('https://example.test/j/'.length);

    await db
      .update(bookings)
      .set({ assignedDriverId: driverB.id })
      .where(eq(bookings.id, booking.id));

    const job = await previewDriverJob(token, { db, secret: SECRET, appUrl: APP_URL });
    expect(job).toEqual({ ok: false, reason: 'not_your_job' });
  });
});
