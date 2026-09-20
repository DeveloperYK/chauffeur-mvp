import { carTypeMatch, carTypeMismatchNote, requestedVehicleClass } from '@/lib/car-type-match';
import { describe, expect, it } from 'vitest';

describe('requestedVehicleClass', () => {
  it('maps a class label to its vehicle class, case-insensitively', () => {
    expect(requestedVehicleClass('MPV')).toBe('mpv');
    expect(requestedVehicleClass('mpv')).toBe('mpv');
    expect(requestedVehicleClass('Luxury')).toBe('luxury');
    expect(requestedVehicleClass('executive')).toBe('executive');
    expect(requestedVehicleClass('Coach')).toBe('coach');
  });

  it('ignores surrounding whitespace', () => {
    expect(requestedVehicleClass('  Luxury  ')).toBe('luxury');
  });

  it('returns null for free text that is not a known class', () => {
    expect(requestedVehicleClass('Range Rover')).toBeNull();
    expect(requestedVehicleClass('MPV or Luxury')).toBeNull();
  });

  it('returns null for empty or missing values', () => {
    expect(requestedVehicleClass(null)).toBeNull();
    expect(requestedVehicleClass(undefined)).toBeNull();
    expect(requestedVehicleClass('')).toBeNull();
    expect(requestedVehicleClass('   ')).toBeNull();
  });
});

describe('carTypeMatch', () => {
  it("is 'match' when the requested class equals the driver's class", () => {
    expect(carTypeMatch('MPV', 'mpv')).toBe('match');
    expect(carTypeMatch('luxury', 'luxury')).toBe('match');
  });

  it("is 'mismatch' when the requested class differs from the driver's class", () => {
    expect(carTypeMatch('MPV', 'executive')).toBe('mismatch');
    expect(carTypeMatch('Coach', 'luxury')).toBe('mismatch');
  });

  it("is 'unknown' when nothing was requested", () => {
    expect(carTypeMatch(null, 'mpv')).toBe('unknown');
    expect(carTypeMatch('', 'mpv')).toBe('unknown');
  });

  it("is 'unknown' when the request is free text outside the class list", () => {
    expect(carTypeMatch('Range Rover', 'luxury')).toBe('unknown');
  });
});

describe('carTypeMismatchNote', () => {
  it('describes the mismatch in operator terms', () => {
    expect(carTypeMismatchNote('MPV', 'executive')).toBe(
      'Booking asks for MPV — this driver is Executive',
    );
  });

  it('returns null when there is no mismatch', () => {
    expect(carTypeMismatchNote('MPV', 'mpv')).toBeNull();
    expect(carTypeMismatchNote(null, 'mpv')).toBeNull();
    expect(carTypeMismatchNote('Range Rover', 'mpv')).toBeNull();
  });
});
