import { parsePoundsFieldToPence, penceToPoundsInput } from '@/lib/money';
import { describe, expect, it } from 'vitest';

describe('parsePoundsFieldToPence', () => {
  it('parses whole and fractional pounds to pence', () => {
    expect(parsePoundsFieldToPence('165')).toBe(16500);
    expect(parsePoundsFieldToPence('82.50')).toBe(8250);
  });

  it('returns null for blank or absent', () => {
    expect(parsePoundsFieldToPence(null)).toBeNull();
    expect(parsePoundsFieldToPence('  ')).toBeNull();
  });

  it('returns NaN for non-numeric input so validation rejects it', () => {
    expect(parsePoundsFieldToPence('abc')).toBeNaN();
  });
});

describe('penceToPoundsInput', () => {
  // Happy paths — pre-filling a pounds input from a stored pence amount.
  it('renders whole pounds without a decimal', () => {
    expect(penceToPoundsInput(25000)).toBe('250');
  });

  it('renders pence as a short decimal', () => {
    expect(penceToPoundsInput(12550)).toBe('125.5');
    expect(penceToPoundsInput(8201)).toBe('82.01');
  });

  it('round-trips with parsePoundsFieldToPence', () => {
    expect(parsePoundsFieldToPence(penceToPoundsInput(12345))).toBe(12345);
  });

  // Unhappy paths — nothing to pre-fill.
  it('is blank when there is no stored amount', () => {
    expect(penceToPoundsInput(null)).toBe('');
    expect(penceToPoundsInput(undefined)).toBe('');
  });

  it('is blank for zero or negative amounts', () => {
    expect(penceToPoundsInput(0)).toBe('');
    expect(penceToPoundsInput(-500)).toBe('');
  });
});
