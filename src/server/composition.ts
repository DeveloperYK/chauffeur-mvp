import { env } from '@/lib/env';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { getDb } from '@/server/db';
import type { NotificationPort } from '@/server/ports/notifications';

const fakeNotifier = new FakeNotificationAdapter();

/** Single composition root. Real adapters are wired in stage 8 / stage 10. */
export function notifications(): NotificationPort {
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
