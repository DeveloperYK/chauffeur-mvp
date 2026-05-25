import type { Booking, Driver } from '@/server/db/schema';
import {
  SMS_BRAND_NAME,
  assignedSms,
  completionRequestSms,
  dispatchSms,
  enRouteSms,
} from '@/server/services/sms-templates';
import { describe, expect, it } from 'vitest';

// Minimal fixtures — only the fields the templates read.
const booking = {
  seq: 1,
  pickupAt: new Date('2026-05-23T14:00:00.000Z'),
  pickupAddress: '12 King St, London',
} as unknown as Booking;

const driver = { name: 'Marcus Bell' } as unknown as Driver;

// Brand + booking reference, e.g. "Chauffeur MVP (BKNG-00001): ".
const PREFIX = `${SMS_BRAND_NAME} (BKNG-00001): `;

describe('SMS templates carry the brand name and booking reference', () => {
  it('exposes a non-empty brand constant', () => {
    expect(SMS_BRAND_NAME).toBe('Chauffeur MVP');
  });

  it('prefixes the assigned-confirmation SMS with the brand + reference', () => {
    const body = assignedSms(booking, driver, 'Mercedes S-Class');
    expect(body.startsWith(PREFIX)).toBe(true);
    expect(body).toContain('BKNG-00001');
    // Existing content is preserved.
    expect(body).toContain('is confirmed');
    expect(body).toContain('Marcus Bell');
    expect(body).toContain('Mercedes S-Class');
    expect(body).toContain('12 King St, London');
  });

  it('prefixes the en-route SMS with the brand + reference', () => {
    const body = enRouteSms(booking, driver);
    expect(body.startsWith(PREFIX)).toBe(true);
    expect(body).toContain('en route');
    expect(body).toContain('Marcus Bell');
  });

  it('builds the driver dispatch SMS with the brand, reference and the link', () => {
    const body = dispatchSms(booking, driver, 'https://app.test/j/abc');
    expect(body.startsWith(PREFIX)).toBe(true);
    expect(body).toContain('https://app.test/j/abc');
    expect(body).toContain('12 King St, London');
    expect(body).toContain('Marcus Bell');
  });

  it('builds the driver completion-request SMS with the brand, reference and the link', () => {
    const body = completionRequestSms(booking, driver, 'https://app.test/j/xyz');
    expect(body.startsWith(PREFIX)).toBe(true);
    expect(body).toContain('https://app.test/j/xyz');
    expect(body.toLowerCase()).toContain('completion');
  });
});
