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

// Channel an automated exec message went out on. SMS is the original path;
// email arrives in a later slice. Recorded per message so the operator can see
// how each one was sent.
export const notificationChannelEnum = pgEnum('notification_channel', ['sms', 'email']);

// Which exec message this is. `assigned` (a driver accepted — booking confirmed)
// and `en_route` (clock fired ~1h before pickup) are the automated sends;
// `changed` is the operator-triggered "booking updated" re-notification after a
// mid-flight change. See docs/shaping/mid-flight-changes.
export const notificationKindEnum = pgEnum('notification_kind', [
  'assigned',
  'en_route',
  'changed',
]);

// Lifecycle of one exec message attempt:
//   sent       — handed to the provider (SMS: accepted by Twilio; email: accepted by Resend)
//   delivered  — provider confirmed delivery (email webhook only)
//   failed     — provider rejected at send, an exception was thrown, or no contact on file
//   bounced    — email bounced after acceptance (webhook)
//   complained — recipient marked the email as spam (webhook)
//   superseded — a later resend replaced this attempt
export const notificationStatusEnum = pgEnum('notification_status', [
  'sent',
  'delivered',
  'failed',
  'bounced',
  'complained',
  'superseded',
]);

// Whether a driver-facing change made to a booking after dispatch has been
// confirmed with the assigned driver, and how far along that is:
//   none      — no unconfirmed change outstanding
//   pending   — a material (driver-facing) field was edited after dispatch and
//               the driver has not yet confirmed they know the new plan
//   confirmed — the driver is aware of and agreed to the new plan
// Orthogonal to `state` — advisory, never blocks the lifecycle. See
// docs/shaping/mid-flight-changes.
export const changeConfirmationStatusEnum = pgEnum('change_confirmation_status', [
  'none',
  'pending',
  'confirmed',
]);

// How a driver confirmation was captured: the driver tapped a link themselves
// (`driver_self`) or the operator attested it after a phone call
// (`operator_attested`). Used for mid-flight change confirmation (and, later,
// for how a driver was assigned to a job).
export const confirmationMethodEnum = pgEnum('confirmation_method', [
  'driver_self',
  'operator_attested',
]);

// Cached, per-booking roll-up of exec-message health so the board can flag a
// problem without a per-tile query:
//   none    — nothing sent yet
//   pending — an email is accepted but delivery is not yet confirmed (email only)
//   ok      — latest message per kind is sent (SMS) or delivered (email)
//   failed  — at least one latest-per-kind message failed/bounced/complained
export const execNotificationStatusEnum = pgEnum('exec_notification_status', [
  'none',
  'pending',
  'ok',
  'failed',
]);

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
    // Exec email address — the recipient when the email channel is active (see
    // EXEC_NOTIFICATION_CHANNEL). Nullable: SMS-mode bookings need not carry one,
    // and it is collected by the booking form only when email is the active
    // channel. An email-mode booking with no address surfaces as a loud failed
    // exec notification, never a silent drop. See docs/shaping/exec-messages.
    execEmail: text('exec_email'),
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
    // How the assigned driver was committed: `driver_self` — the driver tapped
    // their dispatch link; `operator_attested` — the operator phoned them and
    // marked it confirmed (direct assign / swap). Null for unassigned/backfill.
    // See docs/shaping/mid-flight-changes.
    assignmentMethod: confirmationMethodEnum('assignment_method'),

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

    // Mid-flight change confirmation. When a driver-facing field is edited after
    // dispatch (assigned/in_progress), the booking is flagged `pending` so the
    // operator can ensure the assigned driver knows the new plan — either by
    // attesting a phone call (operator_attested) or by the driver tapping a
    // confirm link (driver_self). Advisory and orthogonal to `state`. See
    // docs/shaping/mid-flight-changes.
    changeConfirmationStatus: changeConfirmationStatusEnum('change_confirmation_status')
      .notNull()
      .default('none'),
    // True when the pending change touched something the exec was told (time /
    // pickup / destination). On confirmation, an exec-relevant change auto-emails
    // the exec that the booking was updated; driver-only changes leave it false so
    // confirming them stays silent to the exec. See docs/shaping/mid-flight-changes.
    changeExecRelevant: boolean('change_exec_relevant').notNull().default(false),
    changePendingSince: timestamp('change_pending_since', { withTimezone: true }),
    changeConfirmedAt: timestamp('change_confirmed_at', { withTimezone: true }),
    changeConfirmedMethod: confirmationMethodEnum('change_confirmed_method'),
    changeConfirmedByOperatorId: uuid('change_confirmed_by_operator_id').references(
      () => operators.id,
      { onDelete: 'set null' },
    ),

    // Cached roll-up of exec-message delivery health (see execNotifications).
    // Maintained by the exec-notification wrapper inside the same transaction as
    // the message-row write, so the board can render a failure indicator per
    // tile without joining/aggregating the message log on every render.
    execNotificationStatus: execNotificationStatusEnum('exec_notification_status')
      .notNull()
      .default('none'),

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

// Every automated message sent to the exec over a booking's life, one row per
// attempt — success or failure. Callers never throw the provider result away
// any more: the wrapper (services/exec-notifications) writes a row here whatever
// happens, so operators can see what the exec was told and catch silent send
// failures. `to` is the recipient (phone for sms, email for email); `subject`
// is email-only; `provider_message_id` correlates a later delivery webhook back
// to the row. See docs/shaping/exec-messages.
export const execNotifications = pgTable(
  'exec_notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum('channel').notNull(),
    kind: notificationKindEnum('kind').notNull(),
    to: text('to').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    status: notificationStatusEnum('status').notNull(),
    providerMessageId: text('provider_message_id'),
    errorReason: text('error_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exec_notifications_booking_created_idx').on(t.bookingId, t.createdAt),
    // Partial index for "does this booking have an outstanding problem" lookups.
    index('exec_notifications_failed_idx')
      .on(t.bookingId)
      .where(sql`status in ('failed', 'bounced', 'complained')`),
  ],
);

// ─── Inferred types ─────────────────────────────────────────────────────────

export type BookingState = (typeof bookingStateEnum.enumValues)[number];
export type ChangeConfirmationStatus = (typeof changeConfirmationStatusEnum.enumValues)[number];
export type ConfirmationMethod = (typeof confirmationMethodEnum.enumValues)[number];
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

export type NotificationChannel = (typeof notificationChannelEnum.enumValues)[number];
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];
export type NotificationStatus = (typeof notificationStatusEnum.enumValues)[number];
export type ExecNotificationStatus = (typeof execNotificationStatusEnum.enumValues)[number];
export type ExecNotification = typeof execNotifications.$inferSelect;
export type NewExecNotification = typeof execNotifications.$inferInsert;
