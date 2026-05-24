import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ─── Enums ──────────────────────────────────────────────────────────────────

export const bookingStateEnum = pgEnum('booking_state', [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
  'completed',
  'cancelled',
]);

export const driverTierEnum = pgEnum('driver_tier', ['premium', 'ordinary']);

// Vehicle is captured as free text — operators want to type real model names
// (e.g. "Mercedes S-Class", "BMW X5", "Range Rover", "Mercedes V-Class MPV")
// rather than be constrained to a closed enum.

export const actorTypeEnum = pgEnum('actor_type', ['operator', 'system', 'driver']);

// How the job is sold: a point-to-point `transfer` (price/time derived from the
// route) or `hourly` as-directed hire (price from booked hours, no destination).
export const serviceTypeEnum = pgEnum('service_type', ['transfer', 'hourly']);

// ─── Tables ─────────────────────────────────────────────────────────────────

export const operators = pgTable(
  'operators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('operators_email_idx').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => operators.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const drivers = pgTable(
  'drivers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    tier: driverTierEnum('tier').notNull(),
    defaultCarType: text('default_car_type').notNull(),
    whatsappNumber: text('whatsapp_number').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('drivers_tier_active_idx').on(t.tier, t.active),
    uniqueIndex('drivers_whatsapp_idx').on(t.whatsappNumber),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // State
    state: bookingStateEnum('state').notNull().default('unassigned'),

    // Booking inputs (captured at creation)
    serviceType: serviceTypeEnum('service_type').notNull().default('transfer'),
    pickupAt: timestamp('pickup_at', { withTimezone: true }).notNull(),
    // For transfers: the route's estimated drive time (editable by the operator).
    // For hourly hire: the booked hours × 60. Drives the schedule + clock either way.
    expectedDurationMinutes: integer('expected_duration_minutes').notNull(),
    // Route distance for transfers; null for hourly (no destination). Feeds pricing.
    distanceMeters: integer('distance_meters'),
    pickupAddress: text('pickup_address').notNull(),
    // Null for hourly as-directed bookings (no fixed destination).
    dropoffAddress: text('dropoff_address'),
    passengerFirstName: text('passenger_first_name').notNull(),
    passengerLastName: text('passenger_last_name'),
    execMobile: text('exec_mobile').notNull(),
    // "Customer Account" — the company/account the trip is billed to (e.g.
    // "LEGO Group"). The legacy JJ sheet column J. Stored in account_code.
    clientName: text('client_name').notNull(),
    accountCode: text('account_code').notNull(),
    // "Case code" — the expense code the customer's company uses to cover the
    // cost. Maps to the legacy JJ sheet column D. Nullable: bookings created
    // before this field exist without one.
    caseCode: text('case_code'),
    contractPricePence: integer('contract_price_pence').notNull(),
    notes: text('notes'),

    // Operator ownership (Jira-style)
    createdByOperatorId: uuid('created_by_operator_id').references(() => operators.id, {
      onDelete: 'set null',
    }),
    assignedOperatorId: uuid('assigned_operator_id').references(() => operators.id, {
      onDelete: 'set null',
    }),

    // Driver assignment (set when driver accepts)
    assignedDriverId: uuid('assigned_driver_id').references(() => drivers.id, {
      onDelete: 'restrict',
    }),
    carForThisJob: text('car_for_this_job'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // Completion form (filled by driver)
    carParkPence: integer('car_park_pence'),
    waitingTimeMinutes: integer('waiting_time_minutes'),
    dropoffAt: timestamp('dropoff_at', { withTimezone: true }),
    completionSubmittedAt: timestamp('completion_submitted_at', { withTimezone: true }),

    // Approval
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByOperatorId: uuid('approved_by_operator_id').references(() => operators.id, {
      onDelete: 'set null',
    }),

    // Cancellation
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByOperatorId: uuid('cancelled_by_operator_id').references(() => operators.id, {
      onDelete: 'set null',
    }),
    cancellationReason: text('cancellation_reason'),

    // Auto-flag for no-accept window
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bookings_state_idx').on(t.state),
    index('bookings_pickup_at_idx').on(t.pickupAt),
    index('bookings_state_pickup_idx').on(t.state, t.pickupAt),
    index('bookings_assigned_driver_idx').on(t.assignedDriverId),
    index('bookings_assigned_operator_idx').on(t.assignedOperatorId),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: uuid('actor_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_created_idx').on(t.createdAt),
  ],
);

// Used by Stage 6 token revocation (one-shot links if needed)
export const consumedTokens = pgTable('consumed_tokens', {
  jti: text('jti').primaryKey(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ─── Inferred types ─────────────────────────────────────────────────────────

export type BookingState = (typeof bookingStateEnum.enumValues)[number];
export type DriverTier = (typeof driverTierEnum.enumValues)[number];
export type ServiceType = (typeof serviceTypeEnum.enumValues)[number];
/**
 * Vehicle descriptor — free text. Common values include "Mercedes S-Class",
 * "Mercedes E-Class", "BMW X5", "Range Rover", "Mercedes V-Class MPV", etc.
 */
export type CarType = string;
export type ActorType = (typeof actorTypeEnum.enumValues)[number];

export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
