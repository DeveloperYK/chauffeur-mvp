import { driverJobCalendarUrl } from '@/lib/calendar';
import type { Booking } from '@/server/db/schema';
import { describe, expect, it } from 'vitest';

const booking = {
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
} as unknown as Booking;

const JOB_URL = 'https://chauffeur-prod.vercel.app/j/tok123';

describe('driverJobCalendarUrl', () => {
  // Happy paths
  it('builds a Google Calendar template URL', () => {
    const url = driverJobCalendarUrl(booking, JOB_URL);
    expect(url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe(
      true,
    );
  });

  it('titles the event with the job ref and passenger', () => {
    const url = new URL(driverJobCalendarUrl(booking, JOB_URL));
    expect(url.searchParams.get('text')).toBe('JJ Chauffeuring BKNG-00042 — Eric French');
  });

  it('spans pickup to pickup + duration in UTC', () => {
    const url = new URL(driverJobCalendarUrl(booking, JOB_URL));
    // 08:30Z + 90 min = 10:00Z; Google renders in the viewer's timezone.
    expect(url.searchParams.get('dates')).toBe('20260601T083000Z/20260601T100000Z');
  });

  it('uses the pickup address as the event location', () => {
    const url = new URL(driverJobCalendarUrl(booking, JOB_URL));
    expect(url.searchParams.get('location')).toBe('11 Belsize Park Gardens, London');
  });

  it('includes the route, flight reference and job link in the details', () => {
    const url = new URL(driverJobCalendarUrl(booking, JOB_URL));
    const details = url.searchParams.get('details') ?? '';
    expect(details).toContain('11 Belsize Park Gardens, London -> LHR Terminal 5');
    expect(details).toContain('Flight BA268');
    expect(details).toContain(JOB_URL);
  });

  // Unhappy / edge paths
  it('omits the flight line when there is no travel reference', () => {
    const url = new URL(
      driverJobCalendarUrl({ ...booking, travelMode: null, travelRef: null } as Booking, JOB_URL),
    );
    expect(url.searchParams.get('details')).not.toContain('Flight');
  });

  it('shows an as-directed route for hourly jobs with no destination', () => {
    const url = new URL(
      driverJobCalendarUrl(
        { ...booking, serviceType: 'hourly', dropoffAddress: null } as Booking,
        JOB_URL,
      ),
    );
    expect(url.searchParams.get('details')).toContain('As directed');
  });

  it('handles a missing last name without a trailing space', () => {
    const url = new URL(
      driverJobCalendarUrl({ ...booking, passengerLastName: null } as Booking, JOB_URL),
    );
    expect(url.searchParams.get('text')).toBe('JJ Chauffeuring BKNG-00042 — Eric');
  });
});
