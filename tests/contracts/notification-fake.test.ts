/**
 * Contract tests for FakeNotificationAdapter.
 *
 * Verifies that the fake implementation behaves identically to the real Twilio adapter.
 */

import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { describe } from 'vitest';
import { notificationContractTests } from './notification.contract';

describe('FakeNotificationAdapter', () => {
  let adapter: FakeNotificationAdapter;

  notificationContractTests(
    () => {
      adapter = new FakeNotificationAdapter();
      return adapter;
    },
    () => {
      adapter.reset();
    },
  );
});
