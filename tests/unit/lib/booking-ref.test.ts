import { BOOKING_REF_PREFIX, bookingRef, parseBookingQuery } from '@/lib/booking-ref';
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

describe('parseBookingQuery', () => {
  it('parses a bare number to its seq', () => {
    expect(parseBookingQuery('42')).toBe(42);
    expect(parseBookingQuery('1')).toBe(1);
  });

  it('ignores leading zeros (padded form)', () => {
    expect(parseBookingQuery('00042')).toBe(42);
    expect(parseBookingQuery('00001')).toBe(1);
  });

  it('strips the BKNG- prefix, case-insensitively', () => {
    expect(parseBookingQuery('BKNG-00042')).toBe(42);
    expect(parseBookingQuery('bkng-42')).toBe(42);
    expect(parseBookingQuery('BKNG42')).toBe(42);
    expect(parseBookingQuery('  bkng-00042  ')).toBe(42);
  });

  it('returns null when the query is not an ID', () => {
    expect(parseBookingQuery('marcus')).toBeNull();
    expect(parseBookingQuery('42 King St')).toBeNull(); // address with a number
    expect(parseBookingQuery('')).toBeNull();
    expect(parseBookingQuery('bkng-')).toBeNull();
    expect(parseBookingQuery('0')).toBeNull(); // seq is 1-based
  });
});
