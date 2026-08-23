import { formatMiles, milesStringFromMeters } from '@/lib/distance';
import { describe, expect, it } from 'vitest';

describe('milesStringFromMeters', () => {
  // Happy paths
  it('converts a typical route to miles with 1 decimal', () => {
    expect(milesStringFromMeters(28000)).toBe('17.4'); // 28 km ≈ 17.4 mi
  });

  it('renders exactly one mile as 1.0', () => {
    expect(milesStringFromMeters(1609)).toBe('1.0');
  });

  it('keeps sub-mile distances at 1 decimal', () => {
    expect(milesStringFromMeters(800)).toBe('0.5');
  });

  // Unhappy paths
  it('renders blank for null (hourly jobs have no route)', () => {
    expect(milesStringFromMeters(null)).toBe('');
  });

  it('renders blank for a negative distance', () => {
    expect(milesStringFromMeters(-5)).toBe('');
  });

  it('renders blank for NaN', () => {
    expect(milesStringFromMeters(Number.NaN)).toBe('');
  });

  it('renders zero metres as 0.0 (a real, zero-length route)', () => {
    expect(milesStringFromMeters(0)).toBe('0.0');
  });
});

describe('formatMiles', () => {
  it('appends the mi unit for display', () => {
    expect(formatMiles(28000)).toBe('17.4 mi');
  });

  it('is blank when there is no distance', () => {
    expect(formatMiles(null)).toBe('');
  });
});
