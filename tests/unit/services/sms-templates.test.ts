import type { Booking, Driver } from '@/server/db/schema';
import { SMS_BRAND_NAME, assignedSms, enRouteSms } from '@/server/services/sms-templates';
import { describe, expect, it } from 'vitest';

// Minimal fixtures — only the fields the templates read.
const booking = {
  pickupAt: new Date('2026-05-23T14:00:00.000Z'),
  pickupAddress: '12 King St, London',
} as unknown as Booking;

const driver = { name: 'Marcus Bell' } as unknown as Driver;

describe('SMS templates carry the brand name', () => {
  it('exposes a non-empty brand constant', () => {
    expect(SMS_BRAND_NAME).toBe('Chauffeur MVP');
  });

  it('prefixes the assigned-confirmation SMS with the brand', () => {
    const body = assignedSms(booking, driver, 'Mercedes S-Class');
    expect(body.startsWith(`${SMS_BRAND_NAME}: `)).toBe(true);
    // Existing content is preserved.
    expect(body).toContain('is confirmed');
    expect(body).toContain('Marcus Bell');
    expect(body).toContain('Mercedes S-Class');
    expect(body).toContain('12 King St, London');
  });

  it('prefixes the en-route SMS with the brand', () => {
    const body = enRouteSms(booking, driver);
    expect(body.startsWith(`${SMS_BRAND_NAME}: `)).toBe(true);
    expect(body).toContain('en route');
    expect(body).toContain('Marcus Bell');
  });
});
