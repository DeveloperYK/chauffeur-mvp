import {
  CAR_TYPES,
  carTypeMatch,
  carTypeMismatchNote,
  requestedVehicleClass,
} from '@/lib/car-type-match';
import { describe, expect, it } from 'vitest';

describe('CAR_TYPES', () => {
  it('lists the six JJ vehicle types in order', () => {
    expect(CAR_TYPES.map((t) => t.label)).toEqual([
      'Executive',
      'VIP – S Class',
      'MPV S – 7 Seater',
      'MPV L – 8 Seater',
      'E Car – Electric Only',
      'Coach',
    ]);
  });

  it('maps each type to the driver class it is served by (E Car has none)', () => {
    expect(CAR_TYPES.map((t) => t.vehicleClass)).toEqual([
      'executive',
      'luxury',
      'mpv',
      'mpv',
      null,
      'coach',
    ]);
  });
});

describe('requestedVehicleClass', () => {
  it('maps each picker label to its driver class', () => {
    expect(requestedVehicleClass('Executive')).toBe('executive');
    expect(requestedVehicleClass('VIP – S Class')).toBe('luxury');
    expect(requestedVehicleClass('MPV S – 7 Seater')).toBe('mpv');
    expect(requestedVehicleClass('MPV L – 8 Seater')).toBe('mpv');
    expect(requestedVehicleClass('Coach')).toBe('coach');
  });

  it('accepts the short codes and is case/dash/space-insensitive', () => {
    expect(requestedVehicleClass('ex')).toBe('executive');
    expect(requestedVehicleClass('VIP')).toBe('luxury');
    expect(requestedVehicleClass('vip - s class')).toBe('luxury');
    expect(requestedVehicleClass('MPV S')).toBe('mpv');
    expect(requestedVehicleClass('mpv l')).toBe('mpv');
    expect(requestedVehicleClass('C')).toBe('coach');
    expect(requestedVehicleClass('  coach  ')).toBe('coach');
  });

  it('still understands the legacy class names typed before the picker existed', () => {
    expect(requestedVehicleClass('Luxury')).toBe('luxury');
    expect(requestedVehicleClass('MPV')).toBe('mpv');
  });

  it('has no driver class for E Car (no electric-only class on the roster)', () => {
    expect(requestedVehicleClass('E Car – Electric Only')).toBeNull();
    expect(requestedVehicleClass('e car')).toBeNull();
  });

  it('returns null for free text that is not a known type', () => {
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
  it("is 'match' when the requested type is served by the driver's class", () => {
    expect(carTypeMatch('MPV S – 7 Seater', 'mpv')).toBe('match');
    expect(carTypeMatch('MPV L – 8 Seater', 'mpv')).toBe('match');
    expect(carTypeMatch('VIP – S Class', 'luxury')).toBe('match');
  });

  it("is 'mismatch' when the requested type needs a different class", () => {
    expect(carTypeMatch('MPV S – 7 Seater', 'executive')).toBe('mismatch');
    expect(carTypeMatch('Coach', 'luxury')).toBe('mismatch');
  });

  it("is 'unknown' when nothing was requested", () => {
    expect(carTypeMatch(null, 'mpv')).toBe('unknown');
    expect(carTypeMatch('', 'mpv')).toBe('unknown');
  });

  it("is 'unknown' for E Car and for free text outside the list", () => {
    expect(carTypeMatch('E Car – Electric Only', 'executive')).toBe('unknown');
    expect(carTypeMatch('Range Rover', 'luxury')).toBe('unknown');
  });
});

describe('carTypeMismatchNote', () => {
  it('quotes the requested type and names the driver class', () => {
    expect(carTypeMismatchNote('MPV S – 7 Seater', 'executive')).toBe(
      'Booking asks for MPV S – 7 Seater — this driver is Executive',
    );
    expect(carTypeMismatchNote('  vip  ', 'mpv')).toBe('Booking asks for vip — this driver is MPV');
  });

  it('returns null when there is no mismatch', () => {
    expect(carTypeMismatchNote('MPV L – 8 Seater', 'mpv')).toBeNull();
    expect(carTypeMismatchNote(null, 'mpv')).toBeNull();
    expect(carTypeMismatchNote('E Car – Electric Only', 'mpv')).toBeNull();
    expect(carTypeMismatchNote('Range Rover', 'mpv')).toBeNull();
  });
});
