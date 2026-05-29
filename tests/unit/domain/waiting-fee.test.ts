import { WAITING_FEE_RULES, type WaitingFeeRules, waitingFee } from '@/server/domain/waiting-fee';
import { describe, expect, it } from 'vitest';

// A deterministic rule set for arithmetic assertions, independent of the
// shipped placeholder defaults: 30 min free, £0.50/min, driver keeps 70%.
const RULES: WaitingFeeRules = {
  freeMinutes: 30,
  perMinutePence: 50,
  driverSharePercent: 70,
};

describe('waitingFee', () => {
  it('charges nothing when no waiting time is recorded (null)', () => {
    const fee = waitingFee(null, RULES);
    expect(fee.chargeableMinutes).toBe(0);
    expect(fee.customerFeePence).toBe(0);
    expect(fee.driverPayPence).toBe(0);
    expect(fee.companyMarginPence).toBe(0);
  });

  it('charges nothing for zero minutes', () => {
    expect(waitingFee(0, RULES).customerFeePence).toBe(0);
  });

  it('charges nothing within the free period (under the threshold)', () => {
    expect(waitingFee(10, RULES).customerFeePence).toBe(0);
    expect(waitingFee(29, RULES).chargeableMinutes).toBe(0);
  });

  it('charges nothing at exactly the free threshold (boundary)', () => {
    const fee = waitingFee(30, RULES);
    expect(fee.chargeableMinutes).toBe(0);
    expect(fee.customerFeePence).toBe(0);
  });

  it('charges per minute only for time beyond the free period', () => {
    // 50 min waited -> 20 chargeable min -> 20 * 50p = £10.00
    const fee = waitingFee(50, RULES);
    expect(fee.waitingMinutes).toBe(50);
    expect(fee.chargeableMinutes).toBe(20);
    expect(fee.customerFeePence).toBe(1000);
  });

  it('splits the customer fee into driver share and company margin (rounded)', () => {
    // 31 min -> 1 chargeable min -> 50p customer; 70% -> 35p driver, 15p margin
    const fee = waitingFee(31, RULES);
    expect(fee.customerFeePence).toBe(50);
    expect(fee.driverPayPence).toBe(35);
    expect(fee.companyMarginPence).toBe(15);
  });

  it('rounds the driver share to the nearest penny and margin absorbs the remainder', () => {
    // 33 min -> 3 chargeable -> 150p; 70% = 105p exactly
    const fee = waitingFee(33, RULES);
    expect(fee.customerFeePence).toBe(150);
    expect(fee.driverPayPence).toBe(105);
    expect(fee.companyMarginPence).toBe(45);
    // driver + margin always reconciles to the customer fee
    expect(fee.driverPayPence + fee.companyMarginPence).toBe(fee.customerFeePence);
  });

  it('driver + margin always equals the customer fee (no lost pennies)', () => {
    for (let minutes = 30; minutes <= 120; minutes++) {
      const fee = waitingFee(minutes, RULES);
      expect(fee.driverPayPence + fee.companyMarginPence).toBe(fee.customerFeePence);
    }
  });

  it('handles a large but valid waiting time (12h cap from the form)', () => {
    // 720 min -> 690 chargeable -> 690 * 50p = £345.00
    const fee = waitingFee(720, RULES);
    expect(fee.chargeableMinutes).toBe(690);
    expect(fee.customerFeePence).toBe(34500);
  });

  it('driver gets 100% when configured with a 100% share', () => {
    const fee = waitingFee(40, { freeMinutes: 30, perMinutePence: 50, driverSharePercent: 100 });
    expect(fee.customerFeePence).toBe(500);
    expect(fee.driverPayPence).toBe(500);
    expect(fee.companyMarginPence).toBe(0);
  });

  it('ships sensible placeholder defaults (30 free, 50p/min, 70% driver)', () => {
    expect(WAITING_FEE_RULES.freeMinutes).toBe(30);
    expect(WAITING_FEE_RULES.perMinutePence).toBe(50);
    expect(WAITING_FEE_RULES.driverSharePercent).toBe(70);
    // Uses the shipped defaults when no rules are passed.
    expect(waitingFee(50).customerFeePence).toBe(1000);
  });
});
