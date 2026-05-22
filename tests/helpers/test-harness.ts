/**
 * Unified test harness for integration tests.
 *
 * Provides a consistent setup with:
 * - In-memory database (PGlite)
 * - In-memory notification adapter
 * - In-memory spreadsheet mirror
 * - Controllable clock
 * - Factory methods for creating test entities
 * - Assertion helpers
 */

import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import {
  type Booking,
  type Driver,
  type NewBooking,
  type NewDriver,
  type NewOperator,
  type Operator,
  auditEvents,
  bookings,
  consumedTokens,
  drivers,
  operators,
} from '@/server/db/schema';
import { TestClock } from '@/server/ports/clock';
import { expect } from 'vitest';
import {
  BookingFactory,
  DriverFactory,
  OperatorFactory,
  TestConstants,
} from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from './pglite-db';

export interface TestHarness {
  db: TestDb;
  clock: TestClock;
  notifications: FakeNotificationAdapter;
  mirror: FakeSpreadsheetMirror;

  /** Default operator created during setup */
  defaultOperator: Operator;
  /** Default driver created during setup */
  defaultDriver: Driver;

  /** Create an operator in the database */
  createOperator(data?: Partial<NewOperator>): Promise<Operator>;
  /** Create a driver in the database */
  createDriver(data?: Partial<NewDriver>): Promise<Driver>;
  /** Create a booking in the database */
  createBooking(data: NewBooking): Promise<Booking>;

  /** Assert that an SMS was sent to the given number */
  assertSmsSent(to: string, bodyContains?: string): void;
  /** Assert that no SMS was sent */
  assertNoSmsSent(): void;
  /** Assert that the mirror was updated for a booking */
  assertMirrorUpdated(bookingId: string): void;
  /** Assert that an audit event was recorded */
  assertAuditEvent(action: string, entityId: string): Promise<void>;

  /** Get common dependencies for service calls */
  deps(): {
    db: TestDb;
    clock: TestClock;
    notifications: FakeNotificationAdapter;
    mirror: FakeSpreadsheetMirror;
    secret: string;
    appUrl: string;
  };

  /** Reset state between tests (clears bookings, audit, consumed tokens, SMS, mirror) */
  reset(): Promise<void>;
  /** Close the database connection */
  close(): Promise<void>;
}

/**
 * Create a test harness for integration tests.
 *
 * Usage:
 * ```typescript
 * let harness: TestHarness;
 *
 * beforeAll(async () => {
 *   harness = await createTestHarness();
 * });
 *
 * afterAll(async () => {
 *   await harness.close();
 * });
 *
 * beforeEach(async () => {
 *   await harness.reset();
 * });
 * ```
 */
export async function createTestHarness(): Promise<TestHarness> {
  const { db, close } = await createTestDb();
  const clock = new TestClock(TestConstants.FIXED_TIME);
  const notifications = new FakeNotificationAdapter();
  const mirror = new FakeSpreadsheetMirror();

  // Create default operator
  const [defaultOperator] = await db
    .insert(operators)
    .values(OperatorFactory.alice())
    .returning();

  if (!defaultOperator) {
    throw new Error('Failed to create default operator');
  }

  // Create default driver
  const [defaultDriver] = await db
    .insert(drivers)
    .values(DriverFactory.premiumTom())
    .returning();

  if (!defaultDriver) {
    throw new Error('Failed to create default driver');
  }

  const harness: TestHarness = {
    db,
    clock,
    notifications,
    mirror,
    defaultOperator,
    defaultDriver,

    async createOperator(data = {}) {
      const [op] = await db
        .insert(operators)
        .values({ ...OperatorFactory.bob(), ...data })
        .returning();
      if (!op) throw new Error('Failed to create operator');
      return op;
    },

    async createDriver(data = {}) {
      const [drv] = await db
        .insert(drivers)
        .values({ ...DriverFactory.ordinaryMario(), ...data })
        .returning();
      if (!drv) throw new Error('Failed to create driver');
      return drv;
    },

    async createBooking(data) {
      const [booking] = await db.insert(bookings).values(data).returning();
      if (!booking) throw new Error('Failed to create booking');
      return booking;
    },

    assertSmsSent(to: string, bodyContains?: string) {
      const sent = notifications.sent;
      const matching = sent.filter((sms) => sms.to === to);
      expect(matching.length).toBeGreaterThan(0);
      if (bodyContains) {
        const hasBody = matching.some((sms) => sms.body.includes(bodyContains));
        expect(hasBody).toBe(true);
      }
    },

    assertNoSmsSent() {
      expect(notifications.sent.length).toBe(0);
    },

    assertMirrorUpdated(bookingId: string) {
      expect(mirror.rows.has(bookingId)).toBe(true);
    },

    async assertAuditEvent(action: string, entityId: string) {
      const events = await db.select().from(auditEvents);
      const matching = events.filter(
        (e) => e.action === action && e.entityId === entityId,
      );
      expect(matching.length).toBeGreaterThan(0);
    },

    deps() {
      return {
        db,
        clock,
        notifications,
        mirror,
        secret: TestConstants.SECRET,
        appUrl: TestConstants.APP_URL,
      };
    },

    async reset() {
      await db.delete(auditEvents);
      await db.delete(consumedTokens);
      await db.delete(bookings);
      // Keep operators and drivers between tests for efficiency
      // Reset adapters
      notifications.reset();
      mirror.reset();
      // Reset clock to initial time
      clock.setTo(TestConstants.FIXED_TIME);
    },

    async close() {
      await close();
    },
  };

  return harness;
}

/**
 * Create a minimal test harness without default entities.
 * Use this when you need full control over entity creation.
 */
export async function createMinimalTestHarness(): Promise<{
  db: TestDb;
  clock: TestClock;
  notifications: FakeNotificationAdapter;
  mirror: FakeSpreadsheetMirror;
  deps: () => {
    db: TestDb;
    clock: TestClock;
    notifications: FakeNotificationAdapter;
    mirror: FakeSpreadsheetMirror;
    secret: string;
    appUrl: string;
  };
  reset: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const { db, close } = await createTestDb();
  const clock = new TestClock(TestConstants.FIXED_TIME);
  const notifications = new FakeNotificationAdapter();
  const mirror = new FakeSpreadsheetMirror();

  return {
    db,
    clock,
    notifications,
    mirror,

    deps() {
      return {
        db,
        clock,
        notifications,
        mirror,
        secret: TestConstants.SECRET,
        appUrl: TestConstants.APP_URL,
      };
    },

    async reset() {
      await db.delete(auditEvents);
      await db.delete(consumedTokens);
      await db.delete(bookings);
      await db.delete(drivers);
      await db.delete(operators);
      notifications.reset();
      mirror.reset();
      clock.setTo(TestConstants.FIXED_TIME);
    },

    async close() {
      await close();
    },
  };
}
