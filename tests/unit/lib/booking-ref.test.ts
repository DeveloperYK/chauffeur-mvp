import { BOOKING_REF_PREFIX, bookingRef } from '@/lib/booking-ref';
import { describe, expect, it } from 'vitest';

describe('bookingRef', () => {
  it('zero-pads to 5 digits', () => {
    expect(bookingRef(1)).toBe('BKNG-00001');
    expect(bookingRef(42)).toBe('BKNG-00042');
    expect(bookingRef(99999)).toBe('BKNG-99999');
  });

  it('grows past 5 digits without truncating', () => {
    expect(bookingRef(100000)).toBe('BKNG-100000');
    expect(bookingRef(1234567)).toBe('BKNG-1234567');
  });

  it('uses the shared prefix constant', () => {
    expect(bookingRef(7).startsWith(`${BOOKING_REF_PREFIX}-`)).toBe(true);
  });

  it('handles zero and coerces non-finite to a safe fallback', () => {
    expect(bookingRef(0)).toBe('BKNG-00000');
    expect(bookingRef(Number.NaN)).toBe('BKNG-00000');
  });
});
