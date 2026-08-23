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
    waitingTimeMinutes: null,
    waitingChargePence: null,
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

  it('adds the £1/min waiting charge to the line total', () => {
    // 5 min waited -> £5.00 waiting charge (£1/min from minute 0)
    const r = reconcile([
      bk({ contractPricePence: 30000, carParkPence: 500, waitingTimeMinutes: 5 }),
    ]);
    const line = r.accounts[0]?.caseCodes[0]?.lines[0];
    expect(line?.waitingFeePence).toBe(500);
    expect(line?.totalPence).toBe(31000); // 30000 + 500 + 500
    expect(r.accounts[0]?.caseCodes[0]?.subtotalPence).toBe(31000);
    expect(r.grandTotalPence).toBe(31000);
  });

  it('adds no waiting charge when the driver waited 0 min or it is unrecorded', () => {
    const onTime = reconcile([
      bk({ contractPricePence: 10000, carParkPence: 0, waitingTimeMinutes: 0 }),
    ]);
    expect(onTime.accounts[0]?.caseCodes[0]?.lines[0]?.waitingFeePence).toBe(0);
    expect(onTime.accounts[0]?.caseCodes[0]?.lines[0]?.totalPence).toBe(10000);

    const unrecorded = reconcile([
      bk({ contractPricePence: 10000, carParkPence: 0, waitingTimeMinutes: null }),
    ]);
    expect(unrecorded.accounts[0]?.caseCodes[0]?.lines[0]?.waitingFeePence).toBe(0);
  });

  it('uses the operator override for the waiting charge when set', () => {
    // Driver recorded 5 min (computes £5.00), but the operator waived it to £3.00.
    const r = reconcile([
      bk({
        contractPricePence: 30000,
        carParkPence: 0,
        waitingTimeMinutes: 5,
        waitingChargePence: 300,
      }),
    ]);
    const line = r.accounts[0]?.caseCodes[0]?.lines[0];
    expect(line?.waitingFeePence).toBe(300); // override, not the computed 500
    expect(line?.totalPence).toBe(30300); // 30000 + 0 + 300
  });

  it('treats an override of 0 as a genuine £0 charge (not "use computed")', () => {
    const r = reconcile([
      bk({
        contractPricePence: 30000,
        carParkPence: 0,
        waitingTimeMinutes: 5,
        waitingChargePence: 0,
      }),
    ]);
    expect(r.accounts[0]?.caseCodes[0]?.lines[0]?.waitingFeePence).toBe(0);
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
        waitingTimeMinutes: 50, // £1/min -> £50.00
      }),
    ]);
    const csv = reconciliationCsv(report);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Customer Account');
    expect(lines[0]).toContain('Case Code');
    expect(lines[0]).toContain('Waiting');
    expect(lines[0]).toContain('Total');
    expect(lines[1]).toContain('LEGO Group');
    expect(lines[1]).toContain('LEGO-1');
    expect(lines[1]).toContain('50.00'); // waiting fee in pounds
    expect(lines[1]).toContain('355.00'); // 30000 + 500 + 5000 pence
  });

  it('escapes fields containing commas', () => {
    const report = reconcile([bk({ accountCode: 'Acme, Inc', caseCode: 'C1' })]);
    const csv = reconciliationCsv(report);
    expect(csv).toContain('"Acme, Inc"');
  });
});

describe('bookings with no contract price', () => {
  it('totals only the extras when the contract price is not set', () => {
    const r = reconcile([
      bk({ contractPricePence: null, carParkPence: 500, waitingTimeMinutes: 5 }),
    ]);
    const line = r.accounts[0]?.caseCodes[0]?.lines[0];
    expect(line?.contractPricePence).toBeNull();
    expect(line?.totalPence).toBe(1000); // 500 car park + 500 waiting
    expect(r.grandTotalPence).toBe(1000);
  });

  it('leaves the Contract cell blank in the CSV when the price is not set', () => {
    const report = reconcile([
      bk({ contractPricePence: null, carParkPence: 500, waitingTimeMinutes: null }),
    ]);
    const csv = reconciliationCsv(report);
    const row = csv.trim().split('\n')[1] ?? '';
    // ...Route,Contract,Car Park,Waiting,Total — Contract must be empty, not 0.00.
    expect(row.endsWith(',,5.00,0.00,5.00')).toBe(true);
  });
});
