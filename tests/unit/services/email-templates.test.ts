import type { Booking } from '@/server/db/schema';
import { assignedEmail, enRouteEmail } from '@/server/services/email-templates';
import { describe, expect, it } from 'vitest';

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    seq: 42,
    pickupAt: new Date('2026-05-23T13:00:00.000Z'), // 14:00 London (BST)
    serviceType: 'transfer',
    expectedDurationMinutes: 90,
    pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
    dropoffAddress: 'Heathrow Terminal 5',
    passengerFirstName: 'Eric',
    passengerLastName: 'French',
    ...overrides,
  } as unknown as Booking;
}

describe('services/email-templates', () => {
  it('assignedEmail renders a branded confirmation with all details', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.subject).toContain('BKNG-00042');
    expect(e.subject.toLowerCase()).toContain('confirmed');
    expect(e.html).toContain('<!doctype html>');
    for (const part of [
      'Booking confirmed',
      'Marcus Bell',
      'Black Mercedes S-Class',
      'Eric French',
      'Heathrow Terminal 5',
      'Belsize Park',
    ]) {
      expect(e.html).toContain(part);
      expect(e.text).toContain(part);
    }
  });

  it('enRouteEmail renders a branded en-route message with the pickup time', () => {
    const e = enRouteEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.subject.toLowerCase()).toContain('on the way');
    expect(e.html).toContain('Your driver is on the way');
    expect(e.text).toContain('Marcus Bell');
    expect(e.html).toContain('14:00');
  });

  it('shows "As directed" for an hourly hire instead of a destination', () => {
    const e = assignedEmail(
      booking({ serviceType: 'hourly', dropoffAddress: null, expectedDurationMinutes: 240 }),
      { name: 'X' },
      '',
    );
    expect(e.text).toContain('As directed');
    expect(e.text).toContain('4 hours');
  });

  it('HTML-escapes operator-entered values (no injection) but keeps text raw', () => {
    const e = assignedEmail(
      booking({ pickupAddress: '<script>alert(1)</script> Road' }),
      { name: 'X' },
      '',
    );
    expect(e.html).not.toContain('<script>alert(1)</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('<script>alert(1)</script>');
  });

  it('omits the Vehicle row when no car is provided', () => {
    const e = assignedEmail(booking(), { name: 'X' }, '');
    expect(e.html).not.toContain('Vehicle');
    expect(e.text).not.toContain('Vehicle');
  });
});
