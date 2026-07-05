import { PHONE_HINT, normalizePhone, phoneSchema } from '@/lib/phone';
import { describe, expect, it } from 'vitest';

describe('normalizePhone', () => {
  it('accepts a UK mobile typed the national way (0-prefixed) and normalises to +44', () => {
    expect(normalizePhone('07911 123456')).toBe('+447911123456');
    expect(normalizePhone('07911123456')).toBe('+447911123456');
  });

  it('accepts a UK landline typed 0-prefixed', () => {
    expect(normalizePhone('020 7946 0000')).toBe('+442079460000');
  });

  it('accepts an already-international number and keeps its country', () => {
    expect(normalizePhone('+447911123456')).toBe('+447911123456');
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
  });

  it('rejects nonsense and too-short input', () => {
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('not a phone')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
});

describe('phoneSchema', () => {
  it('parses a 0-prefixed UK number to E.164', () => {
    const r = phoneSchema.safeParse('07911 123456');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('+447911123456');
  });

  it('parses an international number', () => {
    const r = phoneSchema.safeParse('+33 6 12 34 56 78');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('+33612345678');
  });

  it('fails an invalid number with the human hint', () => {
    const r = phoneSchema.safeParse('0791');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe(PHONE_HINT);
  });

  it('requires a value', () => {
    const r = phoneSchema.safeParse('');
    expect(r.success).toBe(false);
  });
});
