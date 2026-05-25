import { formatLondonDateTimeShort, formatLondonTimeOfDay } from '@/lib/dates';
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
  serviceType: 'transfer',
  pickupAt: new Date('2026-05-23T13:00:00.000Z'),
  pickupAddress: '12 King St, London',
  dropoffAddress: 'Heathrow T5',
  expectedDurationMinutes: 45,
} as unknown as Booking;

const hourlyBooking = {
  ...booking,
  serviceType: 'hourly',
  dropoffAddress: null,
  expectedDurationMinutes: 240,
} as unknown as Booking;
const driver = { name: 'Marcus Bell' } as unknown as Driver;

const when = formatLondonDateTimeShort(booking.pickupAt); // BST-aware
const time = formatLondonTimeOfDay(booking.pickupAt);

describe('SMS templates — brand, reference, structured format', () => {
  it('exposes the brand constant', () => {
    expect(SMS_BRAND_NAME).toBe('Chauffeur MVP');
  });

  it('formats the assigned-confirmation SMS for the exec', () => {
    const body = assignedSms(booking, driver, 'Mercedes S-Class');
    expect(body).toBe(
      `${SMS_BRAND_NAME} - BKNG-00001\nConfirmed: ${when}\nDriver: Marcus Bell (Mercedes S-Class)\nPickup: 12 King St, London`,
    );
    expect(body).not.toContain('UTC');
  });

  it('formats the en-route SMS for the exec', () => {
    const body = enRouteSms(booking, driver);
    expect(body.startsWith(`${SMS_BRAND_NAME} - BKNG-00001\n`)).toBe(true);
    expect(body).toContain(`your ${time} pickup`);
    expect(body).toContain('Marcus Bell');
  });

  it('formats the driver dispatch SMS with the route and link', () => {
    const body = dispatchSms(booking, 'https://app.test/s/Ab3xK7');
    expect(body.startsWith(`${SMS_BRAND_NAME} - New job BKNG-00001\n`)).toBe(true);
    expect(body).toContain(when);
    expect(body).toContain('12 King St, London -> Heathrow T5');
    expect(body).toContain('Accept: https://app.test/s/Ab3xK7');
  });

  it('shows pickup + hire length for an hourly dispatch (no destination)', () => {
    const body = dispatchSms(hourlyBooking, 'https://app.test/s/Ab3xK7');
    expect(body).toContain('Pickup: 12 King St, London');
    expect(body).toContain('As directed - 4 hours');
    expect(body).not.toContain('->');
  });

  it('formats singular and fractional hire lengths', () => {
    const oneHour = { ...hourlyBooking, expectedDurationMinutes: 60 } as unknown as Booking;
    const ninety = { ...hourlyBooking, expectedDurationMinutes: 90 } as unknown as Booking;
    expect(dispatchSms(oneHour, 'https://app.test/s/x')).toContain('As directed - 1 hour');
    expect(dispatchSms(ninety, 'https://app.test/s/x')).toContain('As directed - 1.5 hours');
  });

  it('formats the driver completion-request SMS with the link', () => {
    const body = completionRequestSms(booking, 'https://app.test/s/Qz9p2');
    expect(body.startsWith(`${SMS_BRAND_NAME} - BKNG-00001\n`)).toBe(true);
    expect(body.toLowerCase()).toContain('trip form');
    expect(body).toContain('https://app.test/s/Qz9p2');
  });
});
