import {
  DRIVER_FACING_CHANGE_LABELS,
  EXEC_FACING_CHANGE_LABELS,
  isExecFacingChange,
  isMaterialChange,
} from '@/server/domain/booking-changes';
import { describe, expect, it } from 'vitest';

describe('domain/booking-changes — isMaterialChange', () => {
  // ── Material (driver-facing) ──────────────────────────────────────────────
  it('is material when the pickup time changed', () => {
    expect(isMaterialChange(['pickup time'])).toBe(true);
  });

  it('is material when the drop-off changed', () => {
    expect(isMaterialChange(['drop-off'])).toBe(true);
  });

  it('is material when a cosmetic field changes alongside a driver-facing one', () => {
    expect(isMaterialChange(['price', 'pickup address'])).toBe(true);
  });

  it('treats every driver-facing label as material', () => {
    for (const label of DRIVER_FACING_CHANGE_LABELS) {
      expect(isMaterialChange([label])).toBe(true);
    }
  });

  // ── Non-material (invisible to the driver) ────────────────────────────────
  it('is not material for a price-only change', () => {
    expect(isMaterialChange(['price'])).toBe(false);
  });

  it('is not material for exec mobile / customer account / case code / private notes', () => {
    expect(isMaterialChange(['exec mobile'])).toBe(false);
    expect(isMaterialChange(['customer account'])).toBe(false);
    expect(isMaterialChange(['case code'])).toBe(false);
    expect(isMaterialChange(['private notes'])).toBe(false);
    expect(isMaterialChange(['exec email'])).toBe(false);
  });

  it('is not material for an empty change set', () => {
    expect(isMaterialChange([])).toBe(false);
  });

  it('distinguishes driver-facing "notes" from operator-only "private notes"', () => {
    expect(isMaterialChange(['notes'])).toBe(true);
    expect(isMaterialChange(['private notes'])).toBe(false);
  });
});

describe('domain/booking-changes — isExecFacingChange', () => {
  it('is exec-facing for time / pickup / destination', () => {
    for (const label of EXEC_FACING_CHANGE_LABELS) {
      expect(isExecFacingChange([label])).toBe(true);
    }
  });

  it('is NOT exec-facing for driver-only fields (duration, notes, passenger, service type)', () => {
    expect(isExecFacingChange(['duration'])).toBe(false);
    expect(isExecFacingChange(['notes'])).toBe(false);
    expect(isExecFacingChange(['passenger name'])).toBe(false);
    expect(isExecFacingChange(['service type'])).toBe(false);
  });

  it('is NOT exec-facing for cosmetic fields or an empty set', () => {
    expect(isExecFacingChange(['price'])).toBe(false);
    expect(isExecFacingChange(['exec mobile'])).toBe(false);
    expect(isExecFacingChange([])).toBe(false);
  });

  it('every exec-facing label is also driver-facing (exec-facing ⊆ material)', () => {
    for (const label of EXEC_FACING_CHANGE_LABELS) {
      expect(DRIVER_FACING_CHANGE_LABELS).toContain(label);
    }
  });
});
