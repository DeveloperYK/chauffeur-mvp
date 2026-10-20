import { formatPlannedWait, routeSummary } from '@/lib/route-summary';
import { describe, expect, it } from 'vitest';

describe('routeSummary', () => {
  it('joins pickup, stops and destination with arrows, showing a planned wait after its stop', () => {
    expect(
      routeSummary({
        pickupAddress: '11 Belsize Park Gardens, London NW3 4AB',
        dropoffAddress: 'Heathrow Terminal 5, London TW6 2GA',
        stops: [{ address: '1 Canary Wharf, London E14 5AB', plannedWaitMinutes: 40 }],
      }),
    ).toBe('11 Belsize Park Gardens → 1 Canary Wharf (wait 40m) → Heathrow Terminal 5');
  });

  it('omits the wait when a stop has none', () => {
    expect(
      routeSummary({
        pickupAddress: 'A Street, London',
        dropoffAddress: 'B Road, London',
        stops: [{ address: 'C Lane, London', plannedWaitMinutes: 0 }],
      }),
    ).toBe('A Street → C Lane → B Road');
  });

  it('is just pickup → destination with no stops', () => {
    expect(routeSummary({ pickupAddress: 'A Street', dropoffAddress: 'B Road', stops: [] })).toBe(
      'A Street → B Road',
    );
  });

  it('reads "As directed" for an hourly booking with no destination', () => {
    expect(routeSummary({ pickupAddress: 'A Street', dropoffAddress: null, stops: [] })).toBe(
      'A Street → As directed',
    );
  });

  it('keeps stops in sequence order even when given out of order', () => {
    expect(
      routeSummary({
        pickupAddress: 'A',
        dropoffAddress: 'D',
        stops: [
          { seq: 2, address: 'C', plannedWaitMinutes: 0 },
          { seq: 1, address: 'B', plannedWaitMinutes: 0 },
        ],
      }),
    ).toBe('A → B → C → D');
  });

  it('uses the part before the first comma and truncates it when asked, so a tile stays one line', () => {
    expect(
      routeSummary(
        {
          pickupAddress: 'The Shard, 32 London Bridge Street, London SE1 9SG',
          dropoffAddress: 'Cambridge Station, Station Road, Cambridge CB1 2JW',
          stops: [],
        },
        { maxLabel: 12 },
      ),
    ).toBe('The Shard → Cambridge St…');
  });
});

describe('formatPlannedWait', () => {
  it('formats minutes as m / h / h m', () => {
    expect(formatPlannedWait(40)).toBe('40m');
    expect(formatPlannedWait(60)).toBe('1h');
    expect(formatPlannedWait(90)).toBe('1h 30m');
  });
});
