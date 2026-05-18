import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { TwilioNotificationAdapter } from '@/server/adapters/notification-twilio';
import { getDb } from '@/server/db';
import type { NotificationPort } from '@/server/ports/notifications';

const fakeNotifier = new FakeNotificationAdapter();
let twilioNotifier: TwilioNotificationAdapter | undefined;

/** Single composition root. */
export function notifications(): NotificationPort {
  const e = env();
  if (e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM_NUMBER) {
    if (!twilioNotifier) {
      twilioNotifier = new TwilioNotificationAdapter({
        accountSid: e.TWILIO_ACCOUNT_SID,
        authToken: e.TWILIO_AUTH_TOKEN,
        fromNumber: e.TWILIO_FROM_NUMBER,
      });
      logger.info('using TwilioNotificationAdapter');
    }
    return twilioNotifier;
  }
  return fakeNotifier;
}

export function appUrl(): string {
  return env().APP_URL;
}

export function driverLinkSecret(): string {
  const s = env().DRIVER_LINK_SECRET;
  if (!s) {
    throw new Error('DRIVER_LINK_SECRET must be set');
  }
  return s;
}

export function db() {
  const url = env().DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  return getDb(url).db;
}

// Re-export for tests that need the in-memory fake.
export { fakeNotifier };
