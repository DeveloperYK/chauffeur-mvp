import { createHmac } from 'node:crypto';
import {
  type Booking,
  type Driver,
  bookings,
  drivers,
  execNotifications,
  operators,
} from '@/server/db/schema';
import { handleResendWebhook } from '@/server/services/resend-webhook';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

const SECRET = `whsec_${Buffer.from('webhook-signing-key').toString('base64')}`;
const NOW = new Date('2026-06-20T12:00:00.000Z');

function sign(id: string, ts: string, body: string): string {
  const key = Buffer.from(SECRET.replace('whsec_', ''), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;
}

/** Build a correctly-signed webhook request for an event body. */
function signedRequest(body: string, now: Date = NOW) {
  const ts = String(Math.floor(now.getTime() / 1000));
  return {
    headers: { svixId: 'msg_1', svixTimestamp: ts, svixSignature: sign('msg_1', ts, body) },
    rawBody: body,
  };
}

function event(type: string, emailId: string): string {
  return JSON.stringify({ type, data: { email_id: emailId } });
}

describe('services/resend-webhook (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let operatorId: string;
  let driver: Driver;

  const deps = () => ({ db, secret: SECRET, now: NOW });

  async function seedEmailSent(providerMessageId: string): Promise<Booking> {
    const [b] = await db
      .insert(bookings)
      .values({
        ...SeedData.bookings.assigned(operatorId, driver.id),
        execEmail: 'exec@example.com',
        execNotificationStatus: 'pending',
      })
      .returning();
    if (!b) throw new Error('seed failed');
    await db.insert(execNotifications).values({
      bookingId: b.id,
      channel: 'email',
      kind: 'assigned',
      to: 'exec@example.com',
      subject: 'Confirmed',
      body: 'Your driver is confirmed.',
      status: 'sent',
      providerMessageId,
    });
    return b;
  }

  async function statusOf(bookingId: string) {
    const [b] = await db
      .select({ s: bookings.execNotificationStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    return b?.s;
  }

  async function rowStatus(providerMessageId: string) {
    const [r] = await db
      .select({ s: execNotifications.status })
      .from(execNotifications)
      .where(eq(execNotifications.providerMessageId, providerMessageId));
    return r?.s;
  }

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
    const [op] = await db
      .insert(operators)
      .values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' })
      .returning();
    operatorId = op?.id ?? '';
    const [drv] = await db.insert(drivers).values(SeedData.drivers.premiumTom()).returning();
    if (!drv) throw new Error('driver seed failed');
    driver = drv;
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(async () => {
    await db.delete(execNotifications);
    await db.delete(bookings);
  });

  it('delivered event flips the message + booking to delivered/ok', async () => {
    const booking = await seedEmailSent('re_1');
    const { headers, rawBody } = signedRequest(event('email.delivered', 're_1'));
    const res = await handleResendWebhook(deps(), headers, rawBody);

    expect(res.status).toBe(200);
    expect(await rowStatus('re_1')).toBe('delivered');
    expect(await statusOf(booking.id)).toBe('ok');
  });

  it('bounced event marks the booking failed', async () => {
    const booking = await seedEmailSent('re_2');
    const { headers, rawBody } = signedRequest(event('email.bounced', 're_2'));
    await handleResendWebhook(deps(), headers, rawBody);

    expect(await rowStatus('re_2')).toBe('bounced');
    expect(await statusOf(booking.id)).toBe('failed');
  });

  it('complaint marks the booking failed', async () => {
    const booking = await seedEmailSent('re_3');
    const { headers, rawBody } = signedRequest(event('email.complained', 're_3'));
    await handleResendWebhook(deps(), headers, rawBody);

    expect(await rowStatus('re_3')).toBe('complained');
    expect(await statusOf(booking.id)).toBe('failed');
  });

  it('ignores interim events (delivery_delayed) with a 200 and no change', async () => {
    const booking = await seedEmailSent('re_4');
    const { headers, rawBody } = signedRequest(event('email.delivery_delayed', 're_4'));
    const res = await handleResendWebhook(deps(), headers, rawBody);

    expect(res.status).toBe(200);
    expect(await rowStatus('re_4')).toBe('sent');
    expect(await statusOf(booking.id)).toBe('pending');
  });

  it('acks an unknown email id without touching anything', async () => {
    const booking = await seedEmailSent('re_5');
    const { headers, rawBody } = signedRequest(event('email.delivered', 're_unknown'));
    const res = await handleResendWebhook(deps(), headers, rawBody);

    expect(res.status).toBe(200);
    expect(await rowStatus('re_5')).toBe('sent');
    expect(await statusOf(booking.id)).toBe('pending');
  });

  it('does not touch a superseded row', async () => {
    await seedEmailSent('re_6');
    await db
      .update(execNotifications)
      .set({ status: 'superseded' })
      .where(eq(execNotifications.providerMessageId, 're_6'));
    const { headers, rawBody } = signedRequest(event('email.delivered', 're_6'));
    await handleResendWebhook(deps(), headers, rawBody);

    expect(await rowStatus('re_6')).toBe('superseded');
  });

  it('rejects a bad signature with 401', async () => {
    await seedEmailSent('re_7');
    const body = event('email.delivered', 're_7');
    const res = await handleResendWebhook(
      deps(),
      {
        svixId: 'msg_1',
        svixTimestamp: String(Math.floor(NOW.getTime() / 1000)),
        svixSignature: 'v1,deadbeef',
      },
      body,
    );
    expect(res.status).toBe(401);
    expect(await rowStatus('re_7')).toBe('sent');
  });

  it('rejects a stale timestamp with 401', async () => {
    await seedEmailSent('re_8');
    const body = event('email.delivered', 're_8');
    const stale = new Date(NOW.getTime() - 10 * 60 * 1000);
    const { headers, rawBody } = signedRequest(body, stale);
    const res = await handleResendWebhook(deps(), headers, rawBody);
    expect(res.status).toBe(401);
  });

  it('returns 503 when no signing secret is configured', async () => {
    const { headers, rawBody } = signedRequest(event('email.delivered', 're_9'));
    const res = await handleResendWebhook({ db, secret: '', now: NOW }, headers, rawBody);
    expect(res.status).toBe(503);
  });
});
