/**
 * Comprehensive seed data factories for tests.
 *
 * All tests should use these factories to ensure consistent, realistic test data.
 * Factories produce values suitable for DB insertion (NewXxx types).
 */

import type {
  BookingState,
  DriverTier,
  NewBooking,
  NewDriver,
  NewOperator,
} from '@/server/db/schema';

// ─── Operator Factories ─────────────────────────────────────────────────────

export interface OperatorOverrides {
  email?: string;
  passwordHash?: string;
  name?: string;
  active?: boolean;
}

export const OperatorFactory = {
  alice: (overrides?: OperatorOverrides): NewOperator => ({
    email: 'alice@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$test-hash-alice',
    name: 'Alice Smith',
    active: true,
    ...overrides,
  }),

  bob: (overrides?: OperatorOverrides): NewOperator => ({
    email: 'bob@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$test-hash-bob',
    name: 'Bob Jones',
    active: true,
    ...overrides,
  }),

  charlie: (overrides?: OperatorOverrides): NewOperator => ({
    email: 'charlie@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$test-hash-charlie',
    name: 'Charlie Brown',
    active: true,
    ...overrides,
  }),

  inactive: (overrides?: OperatorOverrides): NewOperator => ({
    email: 'inactive-op@example.com',
    passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$test-hash-inactive',
    name: 'Inactive Operator',
    active: false,
    ...overrides,
  }),

  custom: (overrides: OperatorOverrides & { email: string; name: string }): NewOperator => ({
    email: overrides.email,
    passwordHash: overrides.passwordHash ?? '$argon2id$v=19$m=19456,t=2,p=1$test-hash',
    name: overrides.name,
    active: overrides.active ?? true,
  }),
};

// ─── Driver Factories ───────────────────────────────────────────────────────

export interface DriverOverrides {
  name?: string;
  tier?: DriverTier;
  defaultCarType?: string;
  whatsappNumber?: string;
  active?: boolean;
}

export const DriverFactory = {
  premiumTom: (overrides?: DriverOverrides): NewDriver => ({
    name: 'Tom Wright',
    tier: 'premium',
    defaultCarType: 'Mercedes S-Class',
    whatsappNumber: '+447911000001',
    active: true,
    ...overrides,
  }),

  premiumSarah: (overrides?: DriverOverrides): NewDriver => ({
    name: 'Sarah Chen',
    tier: 'premium',
    defaultCarType: 'BMW 7 Series',
    whatsappNumber: '+447911000002',
    active: true,
    ...overrides,
  }),

  ordinaryMario: (overrides?: DriverOverrides): NewDriver => ({
    name: 'Mario Rossi',
    tier: 'ordinary',
    defaultCarType: 'Mercedes E-Class',
    whatsappNumber: '+447911000003',
    active: true,
    ...overrides,
  }),

  ordinaryLisa: (overrides?: DriverOverrides): NewDriver => ({
    name: 'Lisa Thompson',
    tier: 'ordinary',
    defaultCarType: 'Audi A6',
    whatsappNumber: '+447911000004',
    active: true,
    ...overrides,
  }),

  inactive: (overrides?: DriverOverrides): NewDriver => ({
    name: 'Inactive Driver',
    tier: 'ordinary',
    defaultCarType: 'Toyota Camry',
    whatsappNumber: '+447911000099',
    active: false,
    ...overrides,
  }),

  custom: (overrides: DriverOverrides & { name: string; whatsappNumber: string }): NewDriver => ({
    name: overrides.name,
    tier: overrides.tier ?? 'ordinary',
    defaultCarType: overrides.defaultCarType ?? 'Generic Car',
    whatsappNumber: overrides.whatsappNumber,
    active: overrides.active ?? true,
  }),
};

// ─── Booking Factories ──────────────────────────────────────────────────────

export interface BookingOverrides {
  state?: BookingState;
  pickupAt?: Date;
  expectedDurationMinutes?: number;
  pickupAddress?: string;
  dropoffAddress?: string;
  passengerFirstName?: string;
  passengerLastName?: string | null;
  execMobile?: string;
  clientName?: string;
  accountCode?: string;
  caseCode?: string | null;
  contractPricePence?: number;
  notes?: string | null;
  createdByOperatorId?: string | null;
  assignedOperatorId?: string | null;
  assignedDriverId?: string | null;
  carForThisJob?: string | null;
  assignedAt?: Date | null;
  carParkPence?: number | null;
  waitingTimeMinutes?: number | null;
  dropoffAt?: Date | null;
  completionSubmittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedByOperatorId?: string | null;
  cancelledAt?: Date | null;
  cancelledByOperatorId?: string | null;
  cancellationReason?: string | null;
  flaggedAt?: Date | null;
  isBackfill?: boolean;
  backfillDriverName?: string | null;
  backfillDriverPhone?: string | null;
}

const DEFAULT_PICKUP = new Date('2026-06-01T10:00:00.000Z');

export const BookingFactory = {
  /**
   * Unassigned booking - initial state after operator creates it.
   */
  unassigned: (operatorId: string, overrides?: BookingOverrides): NewBooking => ({
    state: 'unassigned',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    ...overrides,
  }),

  /**
   * Assigned booking - driver has accepted the dispatch link.
   */
  assigned: (operatorId: string, driverId: string, overrides?: BookingOverrides): NewBooking => ({
    state: 'assigned',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    assignedDriverId: driverId,
    carForThisJob: 'Mercedes S-Class',
    assignedAt: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  }),

  /**
   * In-progress booking - clock tick has transitioned it (pickup - 1h reached).
   */
  inProgress: (operatorId: string, driverId: string, overrides?: BookingOverrides): NewBooking => ({
    state: 'in_progress',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    assignedDriverId: driverId,
    carForThisJob: 'Mercedes S-Class',
    assignedAt: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  }),

  /**
   * Awaiting driver form - clock tick transitioned after expected duration.
   */
  awaitingDriverForm: (
    operatorId: string,
    driverId: string,
    overrides?: BookingOverrides,
  ): NewBooking => ({
    state: 'awaiting_driver_form',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    assignedDriverId: driverId,
    carForThisJob: 'Mercedes S-Class',
    assignedAt: new Date('2026-05-20T10:00:00.000Z'),
    ...overrides,
  }),

  /**
   * Awaiting operator review - driver has submitted completion form.
   */
  awaitingOperatorReview: (
    operatorId: string,
    driverId: string,
    overrides?: BookingOverrides,
  ): NewBooking => ({
    state: 'awaiting_operator_review',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    assignedDriverId: driverId,
    carForThisJob: 'Mercedes S-Class',
    assignedAt: new Date('2026-05-20T10:00:00.000Z'),
    carParkPence: 500,
    waitingTimeMinutes: 15,
    dropoffAt: new Date('2026-06-01T11:30:00.000Z'),
    completionSubmittedAt: new Date('2026-06-01T12:00:00.000Z'),
    ...overrides,
  }),

  /**
   * Completed booking - operator has approved.
   */
  completed: (operatorId: string, driverId: string, overrides?: BookingOverrides): NewBooking => ({
    state: 'completed',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    assignedDriverId: driverId,
    carForThisJob: 'Mercedes S-Class',
    assignedAt: new Date('2026-05-20T10:00:00.000Z'),
    carParkPence: 500,
    waitingTimeMinutes: 15,
    dropoffAt: new Date('2026-06-01T11:30:00.000Z'),
    completionSubmittedAt: new Date('2026-06-01T12:00:00.000Z'),
    approvedAt: new Date('2026-06-01T14:00:00.000Z'),
    approvedByOperatorId: operatorId,
    ...overrides,
  }),

  /**
   * Cancelled booking.
   */
  cancelled: (operatorId: string, overrides?: BookingOverrides): NewBooking => ({
    state: 'cancelled',
    pickupAt: DEFAULT_PICKUP,
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    execMobile: '+447911999999',
    clientName: 'LEGO Group',
    accountCode: 'LEGO',
    contractPricePence: 30000,
    notes: null,
    createdByOperatorId: operatorId,
    assignedOperatorId: operatorId,
    cancelledAt: new Date('2026-05-25T10:00:00.000Z'),
    cancelledByOperatorId: operatorId,
    cancellationReason: 'Executive cancelled the meeting.',
    ...overrides,
  }),

  /**
   * Custom booking with full control over all fields.
   */
  custom: (operatorId: string, overrides: BookingOverrides & { pickupAt: Date }): NewBooking => ({
    state: overrides.state ?? 'unassigned',
    pickupAt: overrides.pickupAt,
    expectedDurationMinutes: overrides.expectedDurationMinutes ?? 60,
    pickupAddress: overrides.pickupAddress ?? '1 Test Street, London',
    dropoffAddress: overrides.dropoffAddress ?? '2 Test Avenue, London',
    passengerFirstName: overrides.passengerFirstName ?? 'Test',
    passengerLastName: overrides.passengerLastName ?? 'Passenger',
    execMobile: overrides.execMobile ?? '+447900000000',
    clientName: overrides.clientName ?? 'Test Client',
    accountCode: overrides.accountCode ?? 'TEST',
    contractPricePence: overrides.contractPricePence ?? 10000,
    notes: overrides.notes ?? null,
    createdByOperatorId: operatorId,
    assignedOperatorId: overrides.assignedOperatorId ?? operatorId,
    assignedDriverId: overrides.assignedDriverId ?? null,
    carForThisJob: overrides.carForThisJob ?? null,
    assignedAt: overrides.assignedAt ?? null,
    carParkPence: overrides.carParkPence ?? null,
    waitingTimeMinutes: overrides.waitingTimeMinutes ?? null,
    dropoffAt: overrides.dropoffAt ?? null,
    completionSubmittedAt: overrides.completionSubmittedAt ?? null,
    approvedAt: overrides.approvedAt ?? null,
    approvedByOperatorId: overrides.approvedByOperatorId ?? null,
    cancelledAt: overrides.cancelledAt ?? null,
    cancelledByOperatorId: overrides.cancelledByOperatorId ?? null,
    cancellationReason: overrides.cancellationReason ?? null,
    flaggedAt: overrides.flaggedAt ?? null,
    isBackfill: overrides.isBackfill ?? false,
    backfillDriverName: overrides.backfillDriverName ?? null,
    backfillDriverPhone: overrides.backfillDriverPhone ?? null,
  }),
};

// ─── Test Scenarios ─────────────────────────────────────────────────────────

/**
 * Common test constants.
 */
export const TestConstants = {
  SECRET: 'test-secret-must-be-at-least-32-characters-long',
  APP_URL: 'https://example.test',
  FIXED_TIME: '2026-05-18T10:00:00.000Z',
  FUTURE_PICKUP: new Date('2026-06-01T10:00:00.000Z'),
  PAST_PICKUP: new Date('2026-01-01T10:00:00.000Z'),
  VALID_PASSWORD: 'secure-password-12-chars',
  INVALID_PASSWORD: 'short',
};

/**
 * Invalid input fixtures for validation testing.
 */
export const InvalidInputs = {
  phone: {
    noPlus: '447911000001',
    tooShort: '+44',
    letters: '+44abc123456',
    empty: '',
  },
  booking: {
    negativeDuration: -30,
    zeroDuration: 0,
    excessiveDuration: 1000,
    negativePrice: -100,
    shortReason: 'no',
    longReason: 'x'.repeat(1001),
  },
  driver: {
    shortName: 'A',
    longName: 'x'.repeat(200),
  },
  password: {
    tooShort: 'short123',
    empty: '',
  },
};

// Re-export as unified namespace for convenience
export const SeedData = {
  operators: OperatorFactory,
  drivers: DriverFactory,
  bookings: BookingFactory,
  constants: TestConstants,
  invalid: InvalidInputs,
};
