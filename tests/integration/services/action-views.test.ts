import {
  ACTION_VIEWS,
  ACTION_VIEW_GROUPS,
  type ActionViewId,
  isActionViewId,
} from '@/lib/action-views';
import { bookings, dispatchOffers, drivers, operators } from '@/server/db/schema';
import {
  FORM_OUTSTANDING_URGENT_AFTER_MS,
  countActionViews,
  listActionView,
} from '@/server/services/action-views';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

/**
 * The rail's action views: each one names the operator's next step and the
 * count beside it is the number of bookings waiting for exactly that step.
 * The list and the count share one predicate per view, so they can never
 * disagree.
 */
describe('action views', () => {
  describe('registry (pure)', () => {
    it('lists the eight views in lifecycle order, each in a known group', () => {
      const groupIds = new Set(ACTION_VIEW_GROUPS.map((g) => g.id));
      expect(ACTION_VIEWS.map((v) => v.id)).toEqual([
        'to_dispatch',
        'driver_to_accept',
        'confirm_change',
        'send_form',
        'form_outstanding',
        'approve',
        'send_emails',
        'add_price',
      ]);
      for (const v of ACTION_VIEWS) {
        expect(groupIds.has(v.group)).toBe(true);
        expect(v.name.length).toBeGreaterThan(0);
        expect(v.subtitle.length).toBeGreaterThan(0);
      }
    });

    it('names every view with a verb phrase, not a booking state', () => {
      for (const v of ACTION_VIEWS) {
        expect(v.name).not.toMatch(/^(Unassigned|Awaiting|Assigned|In progress)/);
      }
    });

    it('isActionViewId accepts known ids and rejects anything else', () => {
      expect(isActionViewId('send_form')).toBe(true);
      expect(isActionViewId('unassigned')).toBe(false);
      expect(isActionViewId('')).toBe(false);
      expect(isActionViewId(undefined)).toBe(false);
    });
  });

  describe('queries (integration)', () => {
    let db: TestDb;
    let close: () => Promise<void>;
    let driverId: string;
    const NOW = new Date('2026-05-20T12:00:00.000Z');

    beforeAll(async () => {
      const t = await createTestDb();
      db = t.db;
      close = t.close;
      await db.insert(operators).values({ email: 'op@example.com', passwordHash: 'x', name: 'Op' });
      const [drv] = await db
        .insert(drivers)
        .values({
          name: 'Tom',
          vehicleClass: 'executive',
          car: 'Mercedes S-Class',
          carColour: 'Black',
          whatsappNumber: '+447900000001',
        })
        .returning();
      driverId = drv?.id ?? '';
    });

    afterAll(async () => {
      await close();
    });

    beforeEach(async () => {
      await db.delete(dispatchOffers);
      await db.delete(bookings);
    });

    type State =
      | 'unassigned'
      | 'assigned'
      | 'in_progress'
      | 'awaiting_driver_form'
      | 'awaiting_operator_review'
      | 'completed'
      | 'cancelled';

    const insert = async (
      pickupAtIso: string,
      opts: {
        state?: State;
        change?: 'none' | 'pending' | 'confirmed';
        price?: number | null;
        flaggedAt?: Date | null;
        completionLinkSentAt?: Date | null;
        openOffer?: boolean;
        clientName?: string;
      } = {},
    ) => {
      const state = opts.state ?? 'unassigned';
      const [row] = await db
        .insert(bookings)
        .values({
          state,
          assignedDriverId: state === 'unassigned' ? null : driverId,
          pickupAt: new Date(pickupAtIso),
          expectedDurationMinutes: 60,
          pickupAddress: 'A',
          dropoffAddress: 'B',
          passengerFirstName: 'Eric',
          passengerLastName: 'French',
          execMobile: '+447911999999',
          clientName: opts.clientName ?? 'LEGO Group',
          accountCode: 'LEGO',
          contractPricePence: opts.price === undefined ? 10000 : opts.price,
          changeConfirmationStatus: opts.change ?? 'none',
          flaggedAt: opts.flaggedAt ?? null,
          completionLinkSentAt: opts.completionLinkSentAt ?? null,
        })
        .returning();
      if (!row) throw new Error('insert failed');
      if (opts.openOffer) {
        await db
          .insert(dispatchOffers)
          .values({ bookingId: row.id, driverId, jti: `jti-${row.id}`, status: 'open' });
      }
      return row;
    };

    const ids = async (view: ActionViewId) =>
      (await listActionView(db, view, NOW)).map((b) => b.id);

    // ── to_dispatch / driver_to_accept ─────────────────────────────────

    it('to_dispatch: unassigned bookings with no open offer, ordered by pickup', async () => {
      const later = await insert('2026-05-22T10:00:00Z');
      const sooner = await insert('2026-05-21T10:00:00Z');
      await insert('2026-05-21T11:00:00Z', { openOffer: true });
      await insert('2026-05-21T12:00:00Z', { state: 'assigned' });
      expect(await ids('to_dispatch')).toEqual([sooner.id, later.id]);
    });

    it('to_dispatch: a booking whose only offers have lapsed is back in the queue', async () => {
      const b = await insert('2026-05-21T10:00:00Z');
      await db
        .insert(dispatchOffers)
        .values({ bookingId: b.id, driverId, jti: 'lapsed', status: 'lapsed' });
      expect(await ids('to_dispatch')).toEqual([b.id]);
      expect(await ids('driver_to_accept')).toEqual([]);
    });

    it('driver_to_accept: unassigned bookings with an open offer; flagged ones count as urgent', async () => {
      const quiet = await insert('2026-05-21T10:00:00Z', { openOffer: true });
      const flagged = await insert('2026-05-21T09:00:00Z', {
        openOffer: true,
        flaggedAt: new Date('2026-05-20T09:00:00Z'),
      });
      await insert('2026-05-21T08:00:00Z'); // no offer → to_dispatch, not here
      expect(await ids('driver_to_accept')).toEqual([flagged.id, quiet.id]);
      const counts = await countActionViews(db, NOW);
      expect(counts.driver_to_accept).toEqual({ total: 2, urgent: 1 });
      expect(counts.to_dispatch).toEqual({ total: 1, urgent: 1 });
    });

    it('to_dispatch / driver_to_accept: cancelled and dispatched bookings never appear', async () => {
      await insert('2026-05-21T10:00:00Z', { state: 'cancelled' });
      await insert('2026-05-21T10:00:00Z', { state: 'assigned', openOffer: true });
      await insert('2026-05-21T10:00:00Z', { state: 'completed' });
      expect(await ids('to_dispatch')).toEqual([]);
      expect(await ids('driver_to_accept')).toEqual([]);
    });

    // ── confirm_change ────────────────────────────────────────────────

    it('confirm_change: dispatched bookings with a pending change, all urgent', async () => {
      const a = await insert('2026-05-21T10:00:00Z', { state: 'assigned', change: 'pending' });
      const b = await insert('2026-05-21T09:00:00Z', { state: 'in_progress', change: 'pending' });
      await insert('2026-05-21T08:00:00Z', { state: 'assigned', change: 'confirmed' });
      await insert('2026-05-21T07:00:00Z', { state: 'completed', change: 'pending' });
      expect(await ids('confirm_change')).toEqual([b.id, a.id]);
      expect((await countActionViews(db, NOW)).confirm_change).toEqual({ total: 2, urgent: 2 });
    });

    // ── send_form / form_outstanding ──────────────────────────────────

    it('send_form: awaiting_driver_form bookings whose completion link has not been sent', async () => {
      const unsent = await insert('2026-05-19T10:00:00Z', { state: 'awaiting_driver_form' });
      await insert('2026-05-19T09:00:00Z', {
        state: 'awaiting_driver_form',
        completionLinkSentAt: new Date('2026-05-20T11:00:00Z'),
      });
      await insert('2026-05-19T08:00:00Z', { state: 'awaiting_operator_review' });
      expect(await ids('send_form')).toEqual([unsent.id]);
      expect((await countActionViews(db, NOW)).send_form).toEqual({ total: 1, urgent: 1 });
    });

    it('form_outstanding: link sent but no form back; urgent once the send is older than the threshold', async () => {
      const fresh = await insert('2026-05-19T10:00:00Z', {
        state: 'awaiting_driver_form',
        completionLinkSentAt: new Date(NOW.getTime() - FORM_OUTSTANDING_URGENT_AFTER_MS + 60_000),
      });
      const stale = await insert('2026-05-18T10:00:00Z', {
        state: 'awaiting_driver_form',
        completionLinkSentAt: new Date(NOW.getTime() - FORM_OUTSTANDING_URGENT_AFTER_MS - 60_000),
      });
      await insert('2026-05-19T11:00:00Z', { state: 'awaiting_driver_form' }); // unsent
      expect(await ids('form_outstanding')).toEqual([stale.id, fresh.id]);
      expect((await countActionViews(db, NOW)).form_outstanding).toEqual({ total: 2, urgent: 1 });
    });

    it('send_form / form_outstanding: a submitted form (awaiting review) leaves both views', async () => {
      await insert('2026-05-19T10:00:00Z', {
        state: 'awaiting_operator_review',
        completionLinkSentAt: new Date('2026-05-20T11:00:00Z'),
      });
      await insert('2026-05-19T10:00:00Z', { state: 'completed' });
      expect(await ids('send_form')).toEqual([]);
      expect(await ids('form_outstanding')).toEqual([]);
    });

    // ── approve ───────────────────────────────────────────────────────

    it('approve: bookings awaiting operator review, all urgent', async () => {
      const r = await insert('2026-05-19T10:00:00Z', { state: 'awaiting_operator_review' });
      await insert('2026-05-19T10:00:00Z', { state: 'awaiting_driver_form' });
      expect(await ids('approve')).toEqual([r.id]);
      expect((await countActionViews(db, NOW)).approve).toEqual({ total: 1, urgent: 1 });
    });

    // ── add_price ─────────────────────────────────────────────────────

    it('add_price: live bookings without a contract price; £0 counts as priced', async () => {
      const unpriced = await insert('2026-05-21T10:00:00Z', { price: null });
      await insert('2026-05-21T10:00:00Z', { price: 0 });
      await insert('2026-05-21T10:00:00Z', { price: null, state: 'cancelled' });
      expect(await ids('add_price')).toEqual([unpriced.id]);
      expect((await countActionViews(db, NOW)).add_price).toEqual({ total: 1, urgent: 1 });
    });

    // ── send_emails ───────────────────────────────────────────────────

    it('send_emails: a dispatched booking with neither exec email sent is listed', async () => {
      const a = await insert('2026-05-21T10:00:00Z', { state: 'assigned' });
      await insert('2026-05-21T10:00:00Z'); // unassigned: nothing to email yet
      expect(await ids('send_emails')).toEqual([a.id]);
      expect((await countActionViews(db, NOW)).send_emails).toEqual({ total: 1, urgent: 1 });
    });

    // ── counts ────────────────────────────────────────────────────────

    it('countActionViews returns a zero entry for every view on an empty table', async () => {
      const counts = await countActionViews(db, NOW);
      for (const v of ACTION_VIEWS) {
        expect(counts[v.id]).toEqual({ total: 0, urgent: 0 });
      }
    });

    it('count and list agree for every view', async () => {
      await insert('2026-05-21T10:00:00Z');
      await insert('2026-05-21T10:00:00Z', { openOffer: true });
      await insert('2026-05-21T10:00:00Z', { state: 'assigned', change: 'pending', price: null });
      await insert('2026-05-19T10:00:00Z', { state: 'awaiting_driver_form' });
      await insert('2026-05-19T10:00:00Z', {
        state: 'awaiting_driver_form',
        completionLinkSentAt: NOW,
      });
      await insert('2026-05-19T10:00:00Z', { state: 'awaiting_operator_review' });
      const counts = await countActionViews(db, NOW);
      for (const v of ACTION_VIEWS) {
        expect(counts[v.id].total, v.id).toBe((await ids(v.id)).length);
      }
    });
  });
});
