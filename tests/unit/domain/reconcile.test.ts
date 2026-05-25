import { type BillableBooking, reconcile, reconciliationCsv } from '@/server/domain/reconcile';
import { describe, expect, it } from 'vitest';

// Build a minimal billable booking; only the fields reconcile() reads.
function bk(overrides: Partial<BillableBooking> = {}): BillableBooking {
  return {
    seq: 1,
    accountCode: 'LEGO Group',
    caseCode: 'LEGO-2026-001',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    pickupAddress: '11 Belsize Park Gardens',
    dropoffAddress: 'LHR T5',
    pickupAt: new Date('2026-06-01T09:00:00.000Z'),
    contractPricePence: 30000,
    carParkPence: 500,
    ...overrides,
  };
}

describe('reconcile', () => {
  it('returns an empty report for no bookings', () => {
    const r = reconcile([]);
    expect(r.accounts).toEqual([]);
    expect(r.grandTotalPence).toBe(0);
    expect(r.tripCount).toBe(0);
  });

  it('line total = contract price + car park (car park optional)', () => {
    const r = reconcile([bk({ contractPricePence: 30000, carParkPence: 500 })]);
    expect(r.accounts[0]?.caseCodes[0]?.lines[0]?.totalPence).toBe(30500);

    const noPark = reconcile([bk({ contractPricePence: 20000, carParkPence: null })]);
    expect(noPark.accounts[0]?.caseCodes[0]?.lines[0]?.totalPence).toBe(20000);
  });

  it('groups by account then case code, with subtotals and trip counts', () => {
    const r = reconcile([
      bk({
        seq: 1,
        accountCode: 'LEGO Group',
        caseCode: 'A',
        contractPricePence: 10000,
        carParkPence: 0,
      }),
      bk({
        seq: 2,
        accountCode: 'LEGO Group',
        caseCode: 'A',
        contractPricePence: 20000,
        carParkPence: 0,
      }),
      bk({
        seq: 3,
        accountCode: 'LEGO Group',
        caseCode: 'B',
        contractPricePence: 5000,
        carParkPence: 0,
      }),
    ]);
    expect(r.accounts.length).toBe(1);
    const lego = r.accounts[0];
    expect(lego?.account).toBe('LEGO Group');
    expect(lego?.tripCount).toBe(3);
    expect(lego?.totalPence).toBe(35000);
    const caseA = lego?.caseCodes.find((c) => c.caseCode === 'A');
    expect(caseA?.tripCount).toBe(2);
    expect(caseA?.subtotalPence).toBe(30000);
    expect(lego?.caseCodes.find((c) => c.caseCode === 'B')?.subtotalPence).toBe(5000);
  });

  it('sorts accounts by total descending and computes the grand total', () => {
    const r = reconcile([
      bk({ accountCode: 'Small Co', caseCode: 'X', contractPricePence: 5000, carParkPence: 0 }),
      bk({ accountCode: 'Big Co', caseCode: 'Y', contractPricePence: 90000, carParkPence: 0 }),
    ]);
    expect(r.accounts.map((a) => a.account)).toEqual(['Big Co', 'Small Co']);
    expect(r.grandTotalPence).toBe(95000);
  });

  it('handles a missing case code as its own group', () => {
    const r = reconcile([bk({ caseCode: null, contractPricePence: 10000, carParkPence: 0 })]);
    expect(r.accounts[0]?.caseCodes[0]?.caseCode).toBeNull();
  });

  it('formats a line ref and route', () => {
    const r = reconcile([bk({ seq: 42, dropoffAddress: null })]);
    const line = r.accounts[0]?.caseCodes[0]?.lines[0];
    expect(line?.ref).toBe('BKNG-00042');
    expect(line?.route).toContain('As directed'); // hourly / no destination
    expect(line?.passenger).toBe('Eric French');
  });
});

describe('reconciliationCsv', () => {
  it('emits a header plus one row per line, money in pounds', () => {
    const report = reconcile([
      bk({
        seq: 1,
        accountCode: 'LEGO Group',
        caseCode: 'LEGO-1',
        contractPricePence: 30000,
        carParkPence: 500,
      }),
    ]);
    const csv = reconciliationCsv(report);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Customer Account');
    expect(lines[0]).toContain('Case Code');
    expect(lines[0]).toContain('Total');
    expect(lines[1]).toContain('LEGO Group');
    expect(lines[1]).toContain('LEGO-1');
    expect(lines[1]).toContain('305.00'); // 30000 + 500 pence
  });

  it('escapes fields containing commas', () => {
    const report = reconcile([bk({ accountCode: 'Acme, Inc', caseCode: 'C1' })]);
    const csv = reconciliationCsv(report);
    expect(csv).toContain('"Acme, Inc"');
  });
});
