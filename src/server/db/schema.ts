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

// A driver's vehicle class. Each class implies the actual car(s) the driver
// runs, so the system no longer records a separate car/vehicle descriptor —
// the class is the vehicle. Executive and Luxury are saloons; MPV is a people
// carrier; Coach is a minibus/coach.
export const vehicleClassEnum = pgEnum('vehicle_class', ['executive', 'luxury', 'mpv', 'coach']);

export const actorTypeEnum = pgEnum('actor_type', ['operator', 'system', 'driver']);

// Lifecycle of a single dispatch offer (one minted link to one driver):
//   open     — link minted and sent, no resolution yet
//   accepted — this driver accepted the job (the winner of the fan-out)
//   lapsed   — superseded: another driver accepted, the booking was cancelled,
//              or the same driver was re-offered (a fresh open row replaces it)
export const offerStatusEnum = pgEnum('offer_status', ['open', 'accepted', 'lapsed']);

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
    // The driver's vehicle class — one of the four fixed categories. Implies the
    // kind of car; the exact car + colour below let the exec identify it kerbside.
    vehicleClass: vehicleClassEnum('vehicle_class').notNull(),
    // The driver's actual car (make/model, e.g. "Mercedes S-Class") and its
    // colour (e.g. "Black"). Operator-entered on the driver screen; drivers can
    // no longer change the car when accepting a job — it is fixed to the driver.
    car: text('car').notNull(),
    carColour: text('car_colour').notNull(),
    whatsappNumber: text('whatsapp_number').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('drivers_vehicle_class_active_idx').on(t.vehicleClass, t.active),
    uniqueIndex('drivers_whatsapp_idx').on(t.whatsappNumber),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Auto-incrementing human-facing reference number. Rendered as "BKNG-00001"
    // (see lib/booking-ref) in the UI and in every customer/driver message.
    seq: integer('seq').generatedByDefaultAsIdentity(),

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
    // Driver-facing notes. Shown to the driver on the dispatch link page and
    // labelled "Notes for the driver" in the operator UI.
    notes: text('notes'),
    // Operator-only notes. NEVER shown to drivers — kept off the public driver
    // link page entirely. For information the operators want to record but not
    // surface to whoever picks up the job (e.g. difficult client, billing quirk).
    operatorNotes: text('operator_notes'),

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
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // Backfill (subcontractor) driver — used when no internal driver is
    // available and the operator hands the job to someone from the WhatsApp
    // group. The booking moves through assigned → in_progress → completed with
    // `assignedDriverId` null and these free-text fields recording who covered
    // it: the driver's identity (name + phone) and the car they bring. Internal
    // drivers carry their car on the driver profile instead, so this only
    // applies to backfills. See docs/shaping/backfill-drivers.
    isBackfill: boolean('is_backfill').notNull().default(false),
    backfillDriverName: text('backfill_driver_name'),
    backfillDriverPhone: text('backfill_driver_phone'),
    backfillCar: text('backfill_car'),
    // What the backfill (subcontractor) driver is paid for this job, in pence.
    // Internal drivers are salaried — only backfill drivers are paid per booking,
    // so this is null for internal jobs and operator-entered at handoff.
    backfillDriverPayPence: integer('backfill_driver_pay_pence'),

    // Completion form (filled by driver). The driver reports three wall-clock
    // times — arrival, passenger-on-board and completion — plus a parking fee.
    // `waitingTimeMinutes` is derived (on-board − arrival) and still drives the
    // waiting charge; `dropoffAt` is the completion (trip-end) time.
    carParkPence: integer('car_park_pence'),
    arrivalAt: timestamp('arrival_at', { withTimezone: true }),
    passengerOnBoardAt: timestamp('passenger_on_board_at', { withTimezone: true }),
    waitingTimeMinutes: integer('waiting_time_minutes'),
    dropoffAt: timestamp('dropoff_at', { withTimezone: true }),
    completionSubmittedAt: timestamp('completion_submitted_at', { withTimezone: true }),
    // True when the operator entered the completion form on the driver's behalf
    // (driver slow/unreachable, info taken by phone) — this booking skipped the
    // operator-review stage. See docs/shaping/operator-complete-form.
    completionByOperator: boolean('completion_by_operator').notNull().default(false),

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

// Dispatch offers — one row per minted dispatch link (one driver, one booking).
// When an operator fans a job out to several drivers, each gets an `open` offer.
// The first to accept turns their row `accepted` and lapses the rest; cancelling
// the booking lapses any still-open. Lets the console show "Offered to N ·
// awaiting" without re-deriving it from the audit log.
export const dispatchOffers = pgTable(
  'dispatch_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    // The signed link's jti, so an offer can be tied back to its token/audit row.
    jti: text('jti').notNull(),
    status: offerStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when the offer leaves `open` (accepted or lapsed).
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    index('dispatch_offers_booking_idx').on(t.bookingId),
    index('dispatch_offers_booking_status_idx').on(t.bookingId, t.status),
  ],
);

// Branded short links (/s/<code> -> destination) used in driver/exec messages
// instead of the long signed /j/<token> URLs. The token still gates access;
// the code is an opaque lookup key.
export const shortLinks = pgTable('short_links', {
  code: text('code').primaryKey(),
  destination: text('destination').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── Inferred types ─────────────────────────────────────────────────────────

export type BookingState = (typeof bookingStateEnum.enumValues)[number];
export type VehicleClass = (typeof vehicleClassEnum.enumValues)[number];
export type ServiceType = (typeof serviceTypeEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];

export type Operator = typeof operators.$inferSelect;
export type NewOperator = typeof operators.$inferInsert;
export type Driver = typeof drivers.$inferSelect;
export type NewDriver = typeof drivers.$inferInsert;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type OfferStatus = (typeof offerStatusEnum.enumValues)[number];
export type DispatchOffer = typeof dispatchOffers.$inferSelect;
export type NewDispatchOffer = typeof dispatchOffers.$inferInsert;
