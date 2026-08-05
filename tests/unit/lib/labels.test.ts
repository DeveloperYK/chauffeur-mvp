import { carDescription, carLabel } from '@/lib/labels';
import { describe, expect, it } from 'vitest';

describe('carLabel', () => {
  it('returns the car as typed, without any colour', () => {
    expect(carLabel('Mercedes-Benz E-Class')).toBe('Mercedes-Benz E-Class');
  });

  it('trims surrounding whitespace', () => {
    expect(carLabel('  Audi A8  ')).toBe('Audi A8');
  });

  it('maps legacy enum-style values to readable labels', () => {
    expect(carLabel('s_class')).toBe('Mercedes S-Class');
    expect(carLabel('ex')).toBe('Executive');
    expect(carLabel('mpv')).toBe('MPV');
    expect(carLabel('mini_bus')).toBe('Mini bus');
  });

  it('returns an empty string for null, undefined, or empty input', () => {
    expect(carLabel(null)).toBe('');
    expect(carLabel(undefined)).toBe('');
    expect(carLabel('')).toBe('');
  });
});

describe('carDescription', () => {
  it('joins colour and car for SMS/identification contexts', () => {
    expect(carDescription('Mercedes-Benz E-Class', 'Black')).toBe('Black Mercedes-Benz E-Class');
  });

  it('falls back to the car alone when colour is missing', () => {
    expect(carDescription('Audi A8', null)).toBe('Audi A8');
    expect(carDescription('Audi A8', '  ')).toBe('Audi A8');
  });

  it('falls back to the colour alone when car is missing', () => {
    expect(carDescription(null, 'Silver')).toBe('Silver');
  });

  it('returns an empty string when both parts are missing', () => {
    expect(carDescription(null, null)).toBe('');
  });
});
