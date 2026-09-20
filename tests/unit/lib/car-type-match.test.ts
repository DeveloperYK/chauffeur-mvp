import {
  CAR_TYPES,
  carTypeFor,
  carTypeMatch,
  carTypeMismatchNote,
  requestedVehicleClasses,
} from '@/lib/car-type-match';
import { describe, expect, it } from 'vitest';

describe('CAR_TYPES', () => {
  it('is the six vehicle classes, one quick-pick each, in roster order', () => {
    expect(CAR_TYPES.map((t) => [t.vehicleClass, t.label])).toEqual([
      ['executive', 'Executive'],
      ['vip', 'VIP – S Class'],
      ['mpv_s', 'MPV S – 7 Seater'],
      ['mpv_l', 'MPV L – 8 Seater'],
      ['e_car', 'E Car – Electric Only'],
      ['coach', 'Coach'],
    ]);
  });
});

describe('requestedVehicleClasses', () => {
  it('maps each picker label to exactly its driver class', () => {
    expect(requestedVehicleClasses('Executive')).toEqual(['executive']);
    expect(requestedVehicleClasses('VIP – S Class')).toEqual(['vip']);
    expect(requestedVehicleClasses('MPV S – 7 Seater')).toEqual(['mpv_s']);
    expect(requestedVehicleClasses('MPV L – 8 Seater')).toEqual(['mpv_l']);
    expect(requestedVehicleClasses('E Car – Electric Only')).toEqual(['e_car']);
    expect(requestedVehicleClasses('Coach')).toEqual(['coach']);
  });

  it('accepts the short codes and is case/dash/space-insensitive', () => {
    expect(requestedVehicleClasses('ex')).toEqual(['executive']);
    expect(requestedVehicleClasses('VIP')).toEqual(['vip']);
    expect(requestedVehicleClasses('vip - s class')).toEqual(['vip']);
    expect(requestedVehicleClasses('MPV S')).toEqual(['mpv_s']);
    expect(requestedVehicleClasses('mpv l')).toEqual(['mpv_l']);
    expect(requestedVehicleClasses('e car')).toEqual(['e_car']);
    expect(requestedVehicleClasses('C')).toEqual(['coach']);
    expect(requestedVehicleClasses('  coach  ')).toEqual(['coach']);
  });

  it('understands the retired class names on older bookings', () => {
    expect(requestedVehicleClasses('Luxury')).toEqual(['vip']);
    // A plain "MPV" never said which size, so either MPV driver is fine.
    expect(requestedVehicleClasses('MPV')).toEqual(['mpv_s', 'mpv_l']);
  });

  it('is empty for free text that is not a known type', () => {
    expect(requestedVehicleClasses('Range Rover')).toEqual([]);
    expect(requestedVehicleClasses('MPV or Luxury')).toEqual([]);
  });

  it('is empty for empty or missing values', () => {
    expect(requestedVehicleClasses(null)).toEqual([]);
    expect(requestedVehicleClasses(undefined)).toEqual([]);
    expect(requestedVehicleClasses('')).toEqual([]);
    expect(requestedVehicleClasses('   ')).toEqual([]);
  });
});

describe('carTypeFor', () => {
  it('finds the quick-pick a stored value corresponds to', () => {
    expect(carTypeFor('MPV L – 8 Seater')?.vehicleClass).toBe('mpv_l');
    expect(carTypeFor('vip')?.vehicleClass).toBe('vip');
  });

  it('is null for free text, legacy names, and blanks', () => {
    expect(carTypeFor('Range Rover')).toBeNull();
    expect(carTypeFor('MPV')).toBeNull();
    expect(carTypeFor('')).toBeNull();
    expect(carTypeFor(null)).toBeNull();
  });
});

describe('carTypeMatch', () => {
  it("is 'match' when the driver's class is exactly what was asked for", () => {
    expect(carTypeMatch('MPV S – 7 Seater', 'mpv_s')).toBe('match');
    expect(carTypeMatch('E Car – Electric Only', 'e_car')).toBe('match');
    expect(carTypeMatch('MPV', 'mpv_l')).toBe('match');
  });

  it("is 'mismatch' when the class differs — including 7- vs 8-seater", () => {
    expect(carTypeMatch('MPV S – 7 Seater', 'mpv_l')).toBe('mismatch');
    expect(carTypeMatch('MPV L – 8 Seater', 'mpv_s')).toBe('mismatch');
    expect(carTypeMatch('E Car – Electric Only', 'executive')).toBe('mismatch');
    expect(carTypeMatch('Coach', 'vip')).toBe('mismatch');
  });

  it("is 'unknown' when nothing was requested", () => {
    expect(carTypeMatch(null, 'mpv_s')).toBe('unknown');
    expect(carTypeMatch('', 'mpv_s')).toBe('unknown');
  });

  it("is 'unknown' for free text outside the list", () => {
    expect(carTypeMatch('Range Rover', 'vip')).toBe('unknown');
  });
});

describe('carTypeMismatchNote', () => {
  it('quotes the requested type and names the driver class', () => {
    expect(carTypeMismatchNote('MPV S – 7 Seater', 'mpv_l')).toBe(
      'Booking asks for MPV S – 7 Seater — this driver is MPV L – 8 Seater',
    );
    expect(carTypeMismatchNote('  vip  ', 'executive')).toBe(
      'Booking asks for vip — this driver is Executive',
    );
  });

  it('returns null when there is no mismatch', () => {
    expect(carTypeMismatchNote('MPV L – 8 Seater', 'mpv_l')).toBeNull();
    expect(carTypeMismatchNote('MPV', 'mpv_s')).toBeNull();
    expect(carTypeMismatchNote(null, 'mpv_s')).toBeNull();
    expect(carTypeMismatchNote('Range Rover', 'mpv_s')).toBeNull();
  });
});
