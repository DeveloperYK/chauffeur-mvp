import { PLACEHOLDER_PRICING_RULES, metersToMiles, quoteBooking } from '@/server/domain/pricing';
import { describe, expect, it } from 'vitest';

const RULES = PLACEHOLDER_PRICING_RULES;

describe('metersToMiles', () => {
  it('converts metres to miles', () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 5);
    expect(metersToMiles(0)).toBe(0);
  });
});

describe('quoteBooking — transfer', () => {
  // Happy paths
  it('prices a transfer as base + per-mile', () => {
    // 10 miles → £10 base + 10 × £2.20 = £32.00
    const q = quoteBooking({ serviceType: 'transfer', distanceMeters: 10 * 1609.344 }, RULES);
    expect(q.amountPence).toBe(3200);
    expect(q.currency).toBe('GBP');
    expect(q.isEstimate).toBe(true);
    expect(q.breakdown.length).toBeGreaterThan(0);
  });

  it('applies the minimum fare on very short transfers', () => {
    // 1 mile → £10 + £2.20 = £12.20, below £15 minimum → £15.00
    const q = quoteBooking({ serviceType: 'transfer', distanceMeters: 1 * 1609.344 }, RULES);
    expect(q.amountPence).toBe(RULES.transfer.minimumFarePence);
    expect(q.amountPence).toBe(1500);
  });

  it('rounds to whole pence deterministically', () => {
    const q = quoteBooking({ serviceType: 'transfer', distanceMeters: 18.2 * 1609.344 }, RULES);
    // £10 + 18.2 × £2.20 = £50.04 → 5004 pence
    expect(q.amountPence).toBe(5004);
    expect(Number.isInteger(q.amountPence)).toBe(true);
  });

  // Unhappy paths
  it('falls back to the minimum fare for zero distance', () => {
    const q = quoteBooking({ serviceType: 'transfer', distanceMeters: 0 }, RULES);
    expect(q.amountPence).toBe(RULES.transfer.minimumFarePence);
  });

  it('treats a missing/negative distance as the minimum fare', () => {
    const q = quoteBooking({ serviceType: 'transfer', distanceMeters: -5 }, RULES);
    expect(q.amountPence).toBe(RULES.transfer.minimumFarePence);
  });
});

describe('quoteBooking — hourly', () => {
  // Happy paths
  it('prices hourly as rate × hours', () => {
    const q = quoteBooking({ serviceType: 'hourly', hours: 4 }, RULES);
    expect(q.amountPence).toBe(4 * RULES.hourly.hourlyRatePence);
    expect(q.amountPence).toBe(20000);
  });

  it('charges the minimum hours when fewer are booked', () => {
    const q = quoteBooking({ serviceType: 'hourly', hours: 1 }, RULES);
    expect(q.amountPence).toBe(RULES.hourly.minimumHours * RULES.hourly.hourlyRatePence);
    expect(q.amountPence).toBe(10000);
  });

  it('handles fractional hours', () => {
    const q = quoteBooking({ serviceType: 'hourly', hours: 3.5 }, RULES);
    expect(q.amountPence).toBe(Math.round(3.5 * RULES.hourly.hourlyRatePence));
  });

  // Unhappy paths
  it('falls back to the minimum for zero hours', () => {
    const q = quoteBooking({ serviceType: 'hourly', hours: 0 }, RULES);
    expect(q.amountPence).toBe(RULES.hourly.minimumHours * RULES.hourly.hourlyRatePence);
  });

  it('falls back to the minimum for negative hours', () => {
    const q = quoteBooking({ serviceType: 'hourly', hours: -2 }, RULES);
    expect(q.amountPence).toBe(RULES.hourly.minimumHours * RULES.hourly.hourlyRatePence);
  });
});
