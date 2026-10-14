import { ACTION_VIEW_IDS, type ActionViewCounts, type ActionViewId } from '@/lib/action-views';
import type { Database } from '@/server/db';
import { type Booking, bookings, dispatchOffers } from '@/server/db/schema';
import { type SQL, and, asc, eq, isNotNull, isNull, lte, ne, not, sql } from 'drizzle-orm';
import { driverNotToldConditions } from './bookings-query';
import { listEmailAttentionBookings } from './exec-notifications';

/**
 * Queries behind the rail's action views (see `src/lib/action-views.ts` for
 * the labels and ADR 0021 for the reasoning). Each SQL-backed view is ONE
 * predicate shared by its list and its count so the two can never disagree;
 * the "waiting" views also carry an urgency predicate for the red badge.
 *
 * "Send exec emails" is the exception: its rule needs the per-booking email
 * send log, so it reuses `listEmailAttentionBookings` and counts the result.
 */

/** A sent completion form the driver has not returned within this long turns red. */
export const FORM_OUTSTANDING_URGENT_AFTER_MS = 24 * 60 * 60 * 1000;

const LIST_LIMIT = 500;

interface SqlView {
  where: (now: Date) => SQL;
  /** Subset of `where` that is urgent; omitted = everything matching is urgent. */
  urgentWhere?: (now: Date) => SQL;
}

const hasOpenOffer = sql`exists (select 1 from ${dispatchOffers} where ${dispatchOffers.bookingId} = ${bookings.id} and ${dispatchOffers.status} = 'open')`;

const unpricedLive = () =>
  and(isNull(bookings.contractPricePence), ne(bookings.state, 'cancelled'));

const SQL_VIEWS: Record<Exclude<ActionViewId, 'send_emails'>, SqlView> = {
  to_dispatch: {
    where: () => and(eq(bookings.state, 'unassigned'), not(hasOpenOffer)) as SQL,
  },
  driver_to_accept: {
    where: () => and(eq(bookings.state, 'unassigned'), hasOpenOffer) as SQL,
    urgentWhere: () => isNotNull(bookings.flaggedAt),
  },
  confirm_change: {
    where: () => and(...driverNotToldConditions()) as SQL,
  },
  send_form: {
    where: () =>
      and(eq(bookings.state, 'awaiting_driver_form'), isNull(bookings.completionLinkSentAt)) as SQL,
  },
  form_outstanding: {
    where: () =>
      and(
        eq(bookings.state, 'awaiting_driver_form'),
        isNotNull(bookings.completionLinkSentAt),
      ) as SQL,
    urgentWhere: (now) =>
      lte(
        bookings.completionLinkSentAt,
        new Date(now.getTime() - FORM_OUTSTANDING_URGENT_AFTER_MS),
      ),
  },
  approve: {
    where: () => eq(bookings.state, 'awaiting_operator_review'),
  },
  add_price: {
    where: () => unpricedLive() as SQL,
  },
};

function sqlView(id: ActionViewId): SqlView | null {
  return id === 'send_emails' ? null : SQL_VIEWS[id];
}

/** Every booking in the given action view, across all days, soonest pickup first. */
export async function listActionView(
  db: Database,
  id: ActionViewId,
  now: Date = new Date(),
): Promise<Booking[]> {
  const view = sqlView(id);
  if (!view) return listEmailAttentionBookings(db);
  return db
    .select()
    .from(bookings)
    .where(view.where(now))
    .orderBy(asc(bookings.pickupAt))
    .limit(LIST_LIMIT);
}

/** `count(*) filter (where …)` — null-safe, returns text in pg so we Number() it. */
const countWhere = (cond: SQL) => sql<string>`count(*) filter (where ${cond})`;

/**
 * Rail badge numbers for every view in ONE round-trip: a single scan of
 * `bookings` with a `count(*) filter (where …)` pair per view. The console
 * pool is tiny (`max: 2`, see db/index.ts) and the board page is already
 * running its own reads in parallel, so the layout must not fan out N
 * queries of its own. "Send exec emails" still needs its own read (email
 * send log), so the layout costs 3 queries in total.
 */
export async function countActionViews(
  db: Database,
  now: Date = new Date(),
): Promise<ActionViewCounts> {
  const sqlIds = ACTION_VIEW_IDS.filter(
    (id): id is Exclude<ActionViewId, 'send_emails'> => id !== 'send_emails',
  );
  const selection: Record<string, SQL<string>> = {};
  for (const id of sqlIds) {
    const view = SQL_VIEWS[id];
    const where = view.where(now);
    selection[`${id}_total`] = countWhere(where);
    selection[`${id}_urgent`] = countWhere(
      view.urgentWhere ? (and(where, view.urgentWhere(now)) as SQL) : where,
    );
  }
  const [[row], emails] = await Promise.all([
    db.select(selection).from(bookings),
    listEmailAttentionBookings(db),
  ]);
  const counts = Object.fromEntries(
    sqlIds.map((id) => [
      id,
      {
        total: Number(row?.[`${id}_total`] ?? 0),
        urgent: Number(row?.[`${id}_urgent`] ?? 0),
      },
    ]),
  ) as ActionViewCounts;
  return { ...counts, send_emails: { total: emails.length, urgent: emails.length } };
}
