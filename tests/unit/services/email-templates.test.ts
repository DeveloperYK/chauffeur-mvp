import type { Booking } from '@/server/db/schema';
import {
  assignedEmail,
  changeExecEmail,
  driverDetailsEmail,
  renderCustomExecEmail,
} from '@/server/services/email-templates';
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

    const details = driverDetailsEmail(
      booking(),
      { name: 'Marcus Bell' },
      'Black Mercedes S-Class',
      'AB12 CDE',
    );
    expect(details.text).toContain('AB12 CDE');
  });

  it('omits the number-plate row when the driver has none', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.html).not.toContain('Number plate');
    expect(e.text).not.toContain('Number plate');
  });

  it('driverDetailsEmail renders a branded driver-details message', () => {
    const e = driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.subject.toLowerCase()).toContain('driver details');
    expect(e.html).toContain('Your driver details');
    expect(e.text).toContain('Marcus Bell');
    expect(e.html).toContain('14:00');
  });

  it('assignedEmail without a driver omits every driver and vehicle row', () => {
    const e = assignedEmail(booking(), null, 'Black Mercedes S-Class', 'AB12 CDE');
    expect(e.subject.toLowerCase()).toContain('confirmed');
    for (const absent of ['Driver', 'Vehicle', 'Number plate', 'AB12 CDE']) {
      expect(e.text).not.toContain(absent);
    }
    expect(e.text).toContain('Eric French');
    expect(e.text).toContain('Heathrow Terminal 5');
  });

  it('never says the driver will be in touch (client asked for it removed)', () => {
    for (const e of [
      assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      assignedEmail(booking(), null, ''),
      driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
    ]) {
      expect(e.text.toLowerCase()).not.toContain('in touch');
      expect(e.html.toLowerCase()).not.toContain('in touch');
    }
  });

  it('exposes an editable draft body without the brand header or footer', () => {
    const e = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    expect(e.draft).toContain('Marcus Bell');
    expect(e.draft).toContain('Heathrow Terminal 5');
    expect(e.draft).not.toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(e.draft).not.toContain('intended only for the named recipients');
  });

  it('renders "Label: value" lines of the edited draft as a styled details table', () => {
    const e = renderCustomExecEmail(
      'S',
      'Your chauffeur is booked and confirmed. The details are below.\n\nReference: BKNG-00042\nDate & time: Sat 23 May, 14:00\nPickup: 11 Belsize Park Gardens, London NW3 4AB\n\nTo make any changes, please contact our team.',
      'Booking confirmed',
    );
    // The details block becomes a two-column table, not a wall of text.
    expect(e.html).toContain('<table');
    expect(e.html).toContain('>Reference</td>');
    expect(e.html).toContain('BKNG-00042');
    // Values keep their own colons (the time survives the label split).
    expect(e.html).toContain('Sat 23 May, 14:00');
    // The heading renders as the email headline.
    expect(e.html).toContain('Booking confirmed');
    // Intro and closing stay ordinary paragraphs.
    expect(e.html).toContain('Your chauffeur is booked and confirmed.');
    expect(e.html).toContain('To make any changes, please contact our team.');
  });

  it('a fully rewritten draft with no Label: value lines renders as plain paragraphs', () => {
    const e = renderCustomExecEmail('S', 'Hello Eric,\n\nSee you at 2pm outside the hotel.');
    expect(e.html).not.toContain('<table');
    expect(e.html).toContain('See you at 2pm outside the hotel.');
  });

  it('the default draft round-trips into the same table the old auto email had', () => {
    const auto = assignedEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
    const manual = renderCustomExecEmail(auto.subject, auto.draft, 'Booking confirmed');
    for (const part of ['>Driver</td>', 'Marcus Bell', '>Pickup</td>', 'Heathrow Terminal 5']) {
      expect(manual.html).toContain(part);
    }
  });

  it('renderCustomExecEmail wraps operator-edited text in the branded shell', () => {
    const e = renderCustomExecEmail('Custom subject', 'Hello Eric,\n\nSee you at 2pm.');
    expect(e.subject).toBe('Custom subject');
    expect(e.html).toContain('<!doctype html>');
    expect(e.html).toContain('Hello Eric,');
    expect(e.html).toContain('See you at 2pm.');
    // Branding + signature are appended automatically.
    expect(e.html).toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(e.text).toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(e.text).toContain('See you at 2pm.');
  });

  it('renderCustomExecEmail HTML-escapes the operator-edited body', () => {
    const e = renderCustomExecEmail('S', '<script>alert(1)</script> hello');
    expect(e.html).not.toContain('<script>alert(1)</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('<script>alert(1)</script> hello');
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

    const details = driverDetailsEmail(booking(), driver, 'Black Mercedes S-Class', 'AB12 CDE');
    expect(details.html).toContain('Driver PCO');
    expect(details.html).toContain('15472');
    expect(details.text).toContain('+447852188558');
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
      driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      changeExecEmail(booking()),
      renderCustomExecEmail('S', 'body'),
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
