import { bookingRef } from '@/lib/booking-ref';
import { bookings, drivers, operators } from '@/server/db/schema';
import { searchBookings } from '@/server/services/bookings-query';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SeedData } from '~test/fixtures/seed-data';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

describe('searchBookings (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let tomId: string;
  let marcusId: string;
  let seqB1: number;
  let seqB2: number;
  let seqB5: number;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;

    const [op] = await db
      .insert(operators)
      .values(SeedData.operators.alice())
      .returning({ id: operators.id });
    const operatorId = op?.id ?? '';

    const [tom] = await db
      .insert(drivers)
      .values(SeedData.drivers.premiumTom({ name: 'Tom Wright' }))
      .returning({ id: drivers.id });
    const [marcus] = await db
      .insert(drivers)
      .values(SeedData.drivers.custom({ name: 'Marcus Bell', whatsappNumber: '+447911000050' }))
      .returning({ id: drivers.id });
    tomId = tom?.id ?? '';
    marcusId = marcus?.id ?? '';

    // b1: Eric / Tom — 1 Jun, LEGO, CASE-1, Belsize → Heathrow
    // Distinct clientName + execMobile so company-name and phone search are testable.
    const [b1] = await db
      .insert(bookings)
      .values(
        SeedData.bookings.assigned(operatorId, tomId, {
          pickupAt: new Date('2026-06-01T10:00:00Z'),
          passengerFirstName: 'Eric',
          passengerLastName: 'French',
          pickupAddress: '11 Belsize Park Gardens, London',
          dropoffAddress: 'Heathrow Terminal 5',
          accountCode: 'LEGO',
          caseCode: 'CASE-1',
          clientName: 'Northwood Media Holdings',
          execMobile: '+447911123456',
        }),
      )
      .returning({ seq: bookings.seq });
    seqB1 = b1?.seq ?? 0;

    // b2: Jane / Marcus — 3 Jun — "Savoy" appears here only as an address.
    const [b2] = await db
      .insert(bookings)
      .values(
        SeedData.bookings.assigned(operatorId, marcusId, {
          pickupAt: new Date('2026-06-03T10:00:00Z'),
          passengerFirstName: 'Jane',
          passengerLastName: 'Doe',
          pickupAddress: 'The Savoy, Strand, London',
          dropoffAddress: 'London City Airport',
          accountCode: 'LEGO',
        }),
      )
      .returning({ seq: bookings.seq });
    seqB2 = b2?.seq ?? 0;

    // b3: Sophia / unassigned — 2 Jun, ACME, Claridge's
    await db.insert(bookings).values(
      SeedData.bookings.unassigned(operatorId, {
        pickupAt: new Date('2026-06-02T10:00:00Z'),
        passengerFirstName: 'Sophia',
        passengerLastName: 'Loren',
        pickupAddress: "Claridge's, Brook Street, London",
        dropoffAddress: 'Gatwick',
        accountCode: 'ACME',
        caseCode: null,
      }),
    );

    // b4: Eric / Marcus — 5 Jun (same passenger as b1, different driver)
    await db.insert(bookings).values(
      SeedData.bookings.assigned(operatorId, marcusId, {
        pickupAt: new Date('2026-06-05T10:00:00Z'),
        passengerFirstName: 'Eric',
        passengerLastName: 'French',
        pickupAddress: 'Shard, London',
        dropoffAddress: 'Canary Wharf, London',
        accountCode: 'LEGO',
      }),
    );

    // b5: Pat Savoy / unassigned — 31 May (OLDEST). "Savoy" is the surname here,
    // so a "savoy" search must rank this person match above b2's address match
    // even though b2 is newer. Account ZED keeps it out of the LEGO/ACME tests.
    const [b5] = await db
      .insert(bookings)
      .values(
        SeedData.bookings.unassigned(operatorId, {
          pickupAt: new Date('2026-05-31T10:00:00Z'),
          passengerFirstName: 'Pat',
          passengerLastName: 'Savoy',
          pickupAddress: '5 Cornhill, City of London',
          dropoffAddress: 'Stansted',
          accountCode: 'ZED',
          caseCode: null,
        }),
      )
      .returning({ seq: bookings.seq });
    seqB5 = b5?.seq ?? 0;
  });

  afterAll(async () => {
    await close();
  });

  it('finds a booking by exact seq (bare number)', async () => {
    const rows = await searchBookings(db, String(seqB1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(seqB1);
    expect(rows[0]?.driverName).toBe('Tom Wright');
  });

  it('finds a booking by its full reference (BKNG-…)', async () => {
    const rows = await searchBookings(db, bookingRef(seqB1));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(seqB1);
  });

  it('matches the assigned driver name', async () => {
    const rows = await searchBookings(db, 'marcus');
    expect(rows.map((r) => r.passengerFirstName).sort()).toEqual(['Eric', 'Jane']);
    expect(rows.every((r) => r.driverName === 'Marcus Bell')).toBe(true);
  });

  it('matches passenger name and orders newest pickup first', async () => {
    const rows = await searchBookings(db, 'eric');
    expect(rows).toHaveLength(2);
    // b4 (5 Jun) before b1 (1 Jun)
    expect(rows.map((r) => r.pickupAt.toISOString())).toEqual([
      '2026-06-05T10:00:00.000Z',
      '2026-06-01T10:00:00.000Z',
    ]);
  });

  it('matches a full passenger name across first and last (multi-word)', async () => {
    const rows = await searchBookings(db, 'eric french');
    // Both Eric French bookings (b1, b4), newest pickup first.
    expect(rows.map((r) => r.pickupAt.toISOString())).toEqual([
      '2026-06-05T10:00:00.000Z',
      '2026-06-01T10:00:00.000Z',
    ]);
  });

  it('matches the client company name (clientName), distinct from account code', async () => {
    // "Northwood Media Holdings" lives only in b1's clientName — not in any
    // account code — so a multi-word company search resolves to just b1.
    const rows = await searchBookings(db, 'northwood media');
    expect(rows.map((r) => r.seq)).toEqual([seqB1]);
  });

  it('matches the exec phone number typed in +44 form', async () => {
    const rows = await searchBookings(db, '7911123456');
    expect(rows.map((r) => r.seq)).toEqual([seqB1]);
  });

  it('matches the exec phone number typed with a UK leading zero', async () => {
    // Operator types 07911123456; stored value is +447911123456.
    const rows = await searchBookings(db, '07911123456');
    expect(rows.map((r) => r.seq)).toEqual([seqB1]);
  });

  it('matches pickup/dropoff address', async () => {
    const byPickup = await searchBookings(db, 'claridge');
    expect(byPickup.map((r) => r.passengerFirstName)).toEqual(['Sophia']);
    const byDropoff = await searchBookings(db, 'heathrow');
    expect(byDropoff.map((r) => r.seq)).toEqual([seqB1]);
  });

  it('matches account code and case code', async () => {
    const byAccount = await searchBookings(db, 'acme');
    expect(byAccount.map((r) => r.passengerFirstName)).toEqual(['Sophia']);
    const byCase = await searchBookings(db, 'case-1');
    expect(byCase.map((r) => r.seq)).toEqual([seqB1]);
  });

  it('ranks a stronger field match above a newer weaker one (relevance beats recency)', async () => {
    // "savoy" is Pat's surname on b5 (31 May) but only a street name on b2 (3 Jun).
    // The person match must come first despite being the older booking.
    const rows = await searchBookings(db, 'savoy');
    expect(rows.map((r) => r.seq)).toEqual([seqB5, seqB2]);
  });

  it('labels each hit with the field category it matched (matchType)', async () => {
    expect((await searchBookings(db, 'eric'))[0]?.matchType).toBe('person');
    expect((await searchBookings(db, 'marcus'))[0]?.matchType).toBe('person');
    expect((await searchBookings(db, 'heathrow'))[0]?.matchType).toBe('address');
    expect((await searchBookings(db, 'northwood'))[0]?.matchType).toBe('company');
    expect((await searchBookings(db, '07911123456'))[0]?.matchType).toBe('phone');
    expect((await searchBookings(db, String(seqB1)))[0]?.matchType).toBe('ref');
  });

  it('returns empty for no match and for an empty query', async () => {
    expect(await searchBookings(db, 'zzz-no-such-thing')).toEqual([]);
    expect(await searchBookings(db, '   ')).toEqual([]);
  });

  it('bounds results by the limit', async () => {
    const rows = await searchBookings(db, 'london', { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it('scopes to a driver when driverId is given (with a term)', async () => {
    const rows = await searchBookings(db, 'eric', { driverId: tomId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.seq).toBe(seqB1);
  });

  it('lists a driver’s jobs when only driverId is given (empty term)', async () => {
    const rows = await searchBookings(db, '', { driverId: marcusId });
    expect(rows.map((r) => r.pickupAt.toISOString())).toEqual([
      '2026-06-05T10:00:00.000Z',
      '2026-06-03T10:00:00.000Z',
    ]);
  });
});
