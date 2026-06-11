import { type DriverStatusRow, deriveDriverStatus } from '@/lib/driver-status';
import { describe, expect, it } from 'vitest';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

function row(
  offsetMin: number,
  durMin: number,
  pickup: string,
  dropoff: string | null,
): DriverStatusRow {
  const startMs = NOW + offsetMin * MIN;
  return { startMs, endMs: startMs + durMin * MIN, pickup, dropoff };
}

describe('deriveDriverStatus', () => {
  it('reports on-a-job when a window contains now (with its dropoff + end)', () => {
    const status = deriveDriverStatus([row(-20, 60, 'Mayfair', 'Heathrow T5')], NOW);
    expect(status.onJob).toEqual({ dropoff: 'Heathrow T5', untilMs: NOW + 40 * MIN });
    expect(status.next).toBeNull();
  });

  it('reports the next upcoming job when free now', () => {
    const status = deriveDriverStatus([row(90, 60, 'Soho', 'Gatwick')], NOW);
    expect(status.onJob).toBeNull();
    expect(status.next).toEqual({ atMs: NOW + 90 * MIN, pickup: 'Soho', dropoff: 'Gatwick' });
  });

  it('picks the earliest upcoming job as next', () => {
    const status = deriveDriverStatus([row(200, 60, 'Late', 'Z'), row(45, 60, 'Soon', 'A')], NOW);
    expect(status.next?.pickup).toBe('Soon');
  });

  it('prefers on-job and still reports the next future job alongside it', () => {
    const status = deriveDriverStatus(
      [row(-10, 30, 'Now', 'NowDrop'), row(120, 60, 'Later', 'LaterDrop')],
      NOW,
    );
    expect(status.onJob?.dropoff).toBe('NowDrop');
    expect(status.next?.pickup).toBe('Later');
  });

  it('ignores past jobs that have already ended', () => {
    const status = deriveDriverStatus([row(-180, 60, 'Old', 'OldDrop')], NOW);
    expect(status.onJob).toBeNull();
    expect(status.next).toBeNull();
  });

  it('returns all-null for a driver with no jobs', () => {
    expect(deriveDriverStatus([], NOW)).toEqual({ onJob: null, next: null });
  });

  it('keeps the longer-running job when two overlap now', () => {
    const status = deriveDriverStatus(
      [row(-10, 20, 'Short', 'ShortDrop'), row(-10, 90, 'Long', 'LongDrop')],
      NOW,
    );
    expect(status.onJob?.untilMs).toBe(NOW + 80 * MIN);
  });
});
