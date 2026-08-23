import { driverJobIcs } from '@/lib/ics';
import type { Booking } from '@/server/db/schema';
import { describe, expect, it } from 'vitest';

const booking = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  seq: 42,
  serviceType: 'transfer',
  pickupAt: new Date('2026-06-01T08:30:00.000Z'),
  expectedDurationMinutes: 90,
  pickupAddress: '11 Belsize Park Gardens, London',
  dropoffAddress: 'LHR Terminal 5',
  passengerFirstName: 'Eric',
  passengerLastName: 'French',
  travelMode: 'flight',
  travelRef: 'BA268',
  updatedAt: new Date('2026-05-30T10:00:00.000Z'),
} as unknown as Booking;

const JOB_URL = 'https://chauffeur-prod.vercel.app/j/tok123';

describe('driverJobIcs', () => {
  // Happy paths
  it('produces a well-formed VCALENDAR wrapping one VEVENT', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
  });

  it('uses CRLF line endings throughout (RFC 5545)', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics.includes('\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  it('spans pickup to pickup + duration in UTC', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics).toContain('DTSTART:20260601T083000Z');
    expect(ics).toContain('DTEND:20260601T100000Z');
  });

  it('titles the event with the job ref and passenger', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics).toContain('SUMMARY:JJ Chauffeuring BKNG-00042 — Eric French');
  });

  it('has a stable UID derived from the booking id', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics).toContain('UID:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@jj-chauffeuring');
  });

  it('escapes commas in the location per RFC 5545', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    expect(ics).toContain('LOCATION:11 Belsize Park Gardens\\, London');
  });

  it('carries the route, flight reference and job link in the description', () => {
    const ics = driverJobIcs(booking, JOB_URL);
    const unfolded = ics.replace(/\r\n[ \t]/g, '');
    expect(unfolded).toContain('11 Belsize Park Gardens\\, London -> LHR Terminal 5');
    expect(unfolded).toContain('Flight BA268');
    expect(unfolded).toContain(JOB_URL);
  });

  it('folds so no line exceeds 75 octets', () => {
    const long = {
      ...booking,
      pickupAddress:
        'The Landmark London Hotel, 222 Marylebone Road, Marylebone, London NW1 6JQ, United Kingdom',
    } as Booking;
    const ics = driverJobIcs(long, JOB_URL);
    for (const line of ics.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  // Unhappy / edge paths
  it('omits the flight line when there is no travel reference', () => {
    const ics = driverJobIcs({ ...booking, travelMode: null, travelRef: null } as Booking, JOB_URL);
    expect(ics.replace(/\r\n[ \t]/g, '')).not.toContain('Flight');
  });

  it('describes hourly as-directed jobs without a destination', () => {
    const ics = driverJobIcs(
      { ...booking, serviceType: 'hourly', dropoffAddress: null } as Booking,
      JOB_URL,
    );
    expect(ics.replace(/\r\n[ \t]/g, '')).toContain('As directed');
  });

  it('escapes semicolons and literal newlines in free text', () => {
    const ics = driverJobIcs(
      { ...booking, pickupAddress: 'Gate A; ring bell' } as Booking,
      JOB_URL,
    );
    expect(ics).toContain('LOCATION:Gate A\\; ring bell');
  });
});
