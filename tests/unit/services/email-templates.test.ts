import type { Booking } from '@/server/db/schema';
import { assignedEmail, changeExecEmail, enRouteEmail } from '@/server/services/email-templates';
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

  it('shows the number plate when the driver has one, in both emails', () => {
    const confirmed = assignedEmail(
      booking(),
      { name: 'Marcus Bell' },
      'Black Mercedes S-Class',
      'AB12 CDE',
    );
    expect(confirmed.html).toContain('Number plate');
    expect(confirmed.html).toContain('AB12 CDE');
    expect(confirmed.text).toContain('AB12 CDE');

    const enRoute = enRouteEmail(
      booking(),
      { name: 'Marcus Bell' },
      'Black Mercedes S-Class',
      'AB12 CDE',
    );
    expect(enRoute.text).toContain('AB12 CDE');
  });

  it('omits the number-plate row when the driver has none', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.html).not.toContain('Number plate');
    expect(e.text).not.toContain('Number plate');
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

  it('shows the driver PCO number and contact number when provided, in both emails', () => {
    const driver = { name: 'Marcus Bell', pcoNumber: '15472', phone: '+447852188558' };
    const confirmed = assignedEmail(booking(), driver, 'Black Mercedes S-Class', 'AB12 CDE');
    expect(confirmed.html).toContain('Driver PCO');
    expect(confirmed.html).toContain('15472');
    expect(confirmed.html).toContain('Driver contact');
    expect(confirmed.html).toContain('+447852188558');
    expect(confirmed.text).toContain('15472');
    expect(confirmed.text).toContain('+447852188558');

    const enRoute = enRouteEmail(booking(), driver, 'Black Mercedes S-Class', 'AB12 CDE');
    expect(enRoute.html).toContain('Driver PCO');
    expect(enRoute.html).toContain('15472');
    expect(enRoute.text).toContain('+447852188558');
  });

  it('omits the PCO and contact rows when the driver has neither (legacy driver)', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.html).not.toContain('Driver PCO');
    expect(e.html).not.toContain('Driver contact');
    expect(e.text).not.toContain('Driver PCO');
  });

  it('includes the company signature and confidentiality notice in every email footer', () => {
    const emails = [
      assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      enRouteEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      changeExecEmail(booking()),
    ];
    for (const e of emails) {
      for (const part of [
        'JJ Chauffeuring Services (UK) Ltd',
        'info@jjchauffeuringservices.com',
        'www.jjchauffeuringservices.com',
        '+44 (0)208 959 2999 (24 HOURS)',
        'intended only for the named recipients',
        'committed to protecting your personal data',
      ]) {
        expect(e.html).toContain(part);
        expect(e.text).toContain(part);
      }
    }
  });

  it('links the company email and website in the HTML footer', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.html).toContain('mailto:info@jjchauffeuringservices.com');
    expect(e.html).toContain('https://www.jjchauffeuringservices.com');
  });

  it('omits only the missing row when a driver has a phone but no PCO on file', () => {
    const e = assignedEmail(
      booking(),
      { name: 'Marcus Bell', pcoNumber: null, phone: '+447852188558' },
      'Black Mercedes S-Class',
    );
    expect(e.html).not.toContain('Driver PCO');
    expect(e.html).toContain('Driver contact');
    expect(e.text).toContain('+447852188558');
  });
});
