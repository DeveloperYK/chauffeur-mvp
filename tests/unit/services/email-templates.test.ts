import type { Booking } from '@/server/db/schema';
import {
  type EmailParts,
  assignedEmail,
  changeExecEmail,
  driverDetailsEmail,
  renderExecEmail,
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
  it('assignedEmail renders a branded confirmation with the booking details', () => {
    const e = assignedEmail(booking());
    expect(e.subject).toContain('BKNG-00042');
    expect(e.subject.toLowerCase()).toContain('confirmed');
    expect(e.html).toContain('<!doctype html>');
    for (const part of [
      'Booking confirmed',
      'Eric French',
      'Heathrow Terminal 5',
      'Belsize Park',
    ]) {
      expect(e.html).toContain(part);
      expect(e.text).toContain(part);
    }
  });

  it('shows the number plate in the driver-details email when the driver has one', () => {
    const details = driverDetailsEmail(
      booking(),
      { name: 'Marcus Bell' },
      'Black Mercedes S-Class',
      'AB12 CDE',
    );
    expect(details.text).toContain('AB12 CDE');
  });

  it('omits the number-plate row from the driver-details email when the driver has none', () => {
    const e = driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class');
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

  // The confirmation is the booking acknowledgement; the driver-details email
  // is the only one that carries the driver. Before this, assigning a driver
  // first turned the confirmation into a copy of the driver-details email, so
  // the exec got the same message twice.
  it('assignedEmail never carries driver or vehicle rows, so it differs from the driver-details email', () => {
    const e = assignedEmail(booking());
    expect(e.subject.toLowerCase()).toContain('confirmed');
    for (const absent of ['Driver', 'Vehicle', 'Number plate']) {
      expect(e.text).not.toContain(absent);
    }
    expect(e.parts.intro).not.toContain('chauffeur is booked');
    expect(e.text).toContain('Eric French');
    expect(e.text).toContain('Heathrow Terminal 5');
    const details = driverDetailsEmail(
      booking(),
      { name: 'Marcus Bell' },
      'Black Mercedes S-Class',
    );
    expect(details.parts.rows).not.toEqual(e.parts.rows);
  });

  it('never says the driver will be in touch (client asked for it removed)', () => {
    for (const e of [
      assignedEmail(booking()),
      driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
    ]) {
      expect(e.text.toLowerCase()).not.toContain('in touch');
      expect(e.html.toLowerCase()).not.toContain('in touch');
    }
  });

  it('exposes the editable parts — intro, detail rows, closing — without brand header or footer', () => {
    const e = assignedEmail(booking());
    expect(e.parts.intro).toContain('confirmed');
    expect(e.parts.rows).toContainEqual({ label: 'Reference', value: 'BKNG-00042' });
    expect(e.parts.rows).toContainEqual({ label: 'Destination', value: 'Heathrow Terminal 5' });
    expect(e.parts.closing).toContain('contact our team');
    const flat = JSON.stringify(e.parts);
    expect(flat).not.toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(flat).not.toContain('intended only for the named recipients');
  });

  it('the default parts render byte-for-byte the same email as the template', () => {
    for (const auto of [
      assignedEmail(booking()),
      driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      changeExecEmail(booking()),
    ]) {
      const heading = auto.html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1] ?? '';
      const manual = renderExecEmail(auto.subject, auto.parts, heading);
      expect(manual.html).toBe(auto.html);
      expect(manual.text).toBe(auto.text);
    }
  });

  const parts: EmailParts = {
    intro: 'Your chauffeur is booked and confirmed. The details are below.',
    rows: [
      { label: 'Reference', value: 'BKNG-00042' },
      { label: 'Date & time', value: 'Sat 23 May, 14:00' },
      { label: 'Pickup', value: '11 Belsize Park Gardens, London NW3 4AB' },
    ],
    closing: 'To make any changes, please contact our team.',
  };

  it('renderExecEmail renders every detail row as a table row — an added row keeps the table', () => {
    const added = { ...parts, rows: [...parts.rows, { label: 'Flight', value: 'BA123' }] };
    const e = renderExecEmail('S', added, 'Booking confirmed');
    expect(e.html.match(/<tr>/g)?.length).toBe(4);
    expect(e.html).toContain('>Flight</td>');
    expect(e.html).toContain('BA123');
    // Values keep their own colons and the table survives a label with spaces.
    expect(e.html).toContain('Sat 23 May, 14:00');
    expect(e.html).toContain('>Date &amp; time</td>');
    expect(e.html).toContain('<h1');
    expect(e.html).toContain('Booking confirmed');
    expect(e.html).toContain('Your chauffeur is booked and confirmed.');
    expect(e.html).toContain('To make any changes, please contact our team.');
    // Plain-text fallback lists the new row too.
    expect(e.text).toMatch(/Flight\s+BA123/);
  });

  it('renderExecEmail with no rows renders no table, and an empty intro or closing renders nothing', () => {
    const e = renderExecEmail(
      'S',
      { intro: 'Hello Eric,', rows: [], closing: '' },
      'Booking confirmed',
    );
    expect(e.html).not.toContain('<table');
    expect(e.html).toContain('Hello Eric,');
    expect(e.html.match(/<p /g)?.length).toBe(1 + 4); // intro only + 4 footer paragraphs
  });

  it('renderExecEmail never guesses rows from prose — a "Note: …" sentence in the intro stays prose', () => {
    const e = renderExecEmail(
      'S',
      { intro: 'Note: please wait at the side entrance.\nSecond line.', rows: [], closing: '' },
      'Booking confirmed',
    );
    expect(e.html).not.toContain('<table');
    expect(e.html).toContain('Note: please wait at the side entrance.');
    // Line breaks inside a paragraph are preserved.
    expect(e.html).toContain('white-space:pre-line');
  });

  it('renderExecEmail wraps the parts in the branded shell', () => {
    const e = renderExecEmail('Custom subject', parts, 'Booking confirmed');
    expect(e.subject).toBe('Custom subject');
    expect(e.html).toContain('<!doctype html>');
    expect(e.html).toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(e.text).toContain('JJ Chauffeuring Services (UK) Ltd');
    expect(e.text).toContain('To make any changes, please contact our team.');
    expect(e.parts).toEqual(parts);
  });

  it('renderExecEmail HTML-escapes the operator-edited intro, labels and values', () => {
    const e = renderExecEmail(
      'S',
      {
        intro: '<script>alert(1)</script> hello',
        rows: [{ label: '<b>Flight</b>', value: 'BA<123>' }],
        closing: '',
      },
      'Booking confirmed',
    );
    expect(e.html).not.toContain('<script>alert(1)</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.html).toContain('&lt;b&gt;Flight&lt;/b&gt;');
    expect(e.html).toContain('BA&lt;123&gt;');
    expect(e.text).toContain('<script>alert(1)</script> hello');
  });

  it('shows "As directed" for an hourly hire instead of a destination', () => {
    const e = assignedEmail(
      booking({ serviceType: 'hourly', dropoffAddress: null, expectedDurationMinutes: 240 }),
    );
    expect(e.text).toContain('As directed');
    expect(e.text).toContain('4 hours');
  });

  it('HTML-escapes operator-entered values (no injection) but keeps text raw', () => {
    const e = assignedEmail(booking({ pickupAddress: '<script>alert(1)</script> Road' }));
    expect(e.html).not.toContain('<script>alert(1)</script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('<script>alert(1)</script>');
  });

  it('omits the Vehicle row from the driver-details email when no car is provided', () => {
    const e = driverDetailsEmail(booking(), { name: 'X' }, '');
    expect(e.html).not.toContain('Vehicle');
    expect(e.text).not.toContain('Vehicle');
  });

  it('shows the driver PCO number and contact number when provided', () => {
    const driver = { name: 'Marcus Bell', pcoNumber: '15472', phone: '+447852188558' };
    const details = driverDetailsEmail(booking(), driver, 'Black Mercedes S-Class', 'AB12 CDE');
    expect(details.html).toContain('Driver PCO');
    expect(details.html).toContain('15472');
    expect(details.text).toContain('+447852188558');
  });

  it('omits the PCO and contact rows when the driver has neither (legacy driver)', () => {
    const e = assignedEmail(booking());
    expect(e.html).not.toContain('Driver PCO');
    expect(e.html).not.toContain('Driver contact');
    expect(e.text).not.toContain('Driver PCO');
  });

  it('includes the company signature and confidentiality notice in every email footer', () => {
    const emails = [
      assignedEmail(booking()),
      driverDetailsEmail(booking(), { name: 'Marcus Bell' }, 'Black Mercedes S-Class'),
      changeExecEmail(booking()),
      renderExecEmail('S', { intro: 'body', rows: [], closing: '' }, 'Booking confirmed'),
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
    const e = assignedEmail(booking());
    expect(e.html).toContain('mailto:info@jjchauffeuringservices.com');
    expect(e.html).toContain('https://www.jjchauffeuringservices.com');
  });

  it('omits only the missing row when a driver has a phone but no PCO on file', () => {
    const e = driverDetailsEmail(
      booking(),
      { name: 'Marcus Bell', pcoNumber: null, phone: '+447852188558' },
      'Black Mercedes S-Class',
    );
    expect(e.html).not.toContain('Driver PCO');
    expect(e.html).toContain('Driver contact');
    expect(e.text).toContain('+447852188558');
  });
});

describe('services/email-templates — flight/train and requested vehicle rows', () => {
  const driver = { name: 'Tom Hardy' };
  const withTravel = { travelMode: 'flight' as const, travelRef: 'BA268', requestedCarType: 'MPV' };

  it('confirmation email shows the Flight row and the Requested vehicle row', () => {
    const e = assignedEmail(booking(withTravel));
    expect(e.parts.rows).toContainEqual({ label: 'Flight', value: 'BA268' });
    expect(e.parts.rows).toContainEqual({ label: 'Requested vehicle', value: 'MPV' });
    expect(e.html).toContain('>Flight</td>');
    expect(e.text).toMatch(/Flight\s+BA268/);
    expect(e.text).toMatch(/Requested vehicle\s+MPV/);
  });

  it('driver-details email shows the Flight row and the Requested vehicle row', () => {
    const e = driverDetailsEmail(booking(withTravel), driver, 'Mercedes V-Class', 'AB12 CDE');
    expect(e.parts.rows).toContainEqual({ label: 'Flight', value: 'BA268' });
    expect(e.parts.rows).toContainEqual({ label: 'Requested vehicle', value: 'MPV' });
    // The driver's actual car stays its own row.
    expect(e.parts.rows).toContainEqual({ label: 'Vehicle', value: 'Mercedes V-Class' });
  });

  it('booking-update email shows the Flight row and the Requested vehicle row', () => {
    const e = changeExecEmail(booking(withTravel));
    expect(e.parts.rows).toContainEqual({ label: 'Flight', value: 'BA268' });
    expect(e.parts.rows).toContainEqual({ label: 'Requested vehicle', value: 'MPV' });
  });

  it('labels a train reference as Train', () => {
    const e = assignedEmail(
      booking({ travelMode: 'train', travelRef: '12:03 from Manchester Piccadilly' }),
    );
    expect(e.parts.rows).toContainEqual({
      label: 'Train',
      value: '12:03 from Manchester Piccadilly',
    });
    expect(e.parts.rows.some((r) => r.label === 'Flight')).toBe(false);
  });

  it('places the travel row directly after Pickup, and the requested vehicle after Destination', () => {
    const labels = assignedEmail(booking(withTravel)).parts.rows.map((r) => r.label);
    expect(labels.indexOf('Flight')).toBe(labels.indexOf('Pickup') + 1);
    expect(labels.indexOf('Requested vehicle')).toBe(labels.indexOf('Destination') + 1);
  });

  it('omits both rows when the booking has neither a travel reference nor a requested vehicle', () => {
    for (const e of [
      assignedEmail(booking()),
      driverDetailsEmail(booking(), driver, 'Car'),
      changeExecEmail(booking()),
    ]) {
      const labels = e.parts.rows.map((r) => r.label);
      expect(labels).not.toContain('Flight');
      expect(labels).not.toContain('Train');
      expect(labels).not.toContain('Requested vehicle');
    }
  });

  it('omits the travel row when the mode is set but the reference is blank, and vice versa', () => {
    const noRef = assignedEmail(booking({ travelMode: 'flight', travelRef: '  ' }));
    expect(noRef.parts.rows.some((r) => r.label === 'Flight')).toBe(false);
    const noMode = assignedEmail(booking({ travelMode: null, travelRef: 'BA268' }));
    expect(noMode.parts.rows.some((r) => r.label === 'Flight' || r.label === 'Train')).toBe(false);
  });

  it('omits the Requested vehicle row when the requested car type is blank', () => {
    const e = assignedEmail(booking({ requestedCarType: '   ' }));
    expect(e.parts.rows.some((r) => r.label === 'Requested vehicle')).toBe(false);
  });

  it('HTML-escapes the requested vehicle and travel reference', () => {
    const e = assignedEmail(
      booking({ travelMode: 'train', travelRef: '<b>late</b>', requestedCarType: 'S&S <van>' }),
    );
    expect(e.html).not.toContain('<b>late</b>');
    expect(e.html).toContain('&lt;b&gt;late&lt;/b&gt;');
    expect(e.html).toContain('S&amp;S &lt;van&gt;');
    expect(e.text).toContain('S&S <van>');
  });
});
