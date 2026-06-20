import { AUTO_REFRESH_INTERVAL_MS, shouldAutoRefresh } from '@/components/console/auto-refresh';
import { describe, expect, it } from 'vitest';

describe('shouldAutoRefresh', () => {
  // Happy path: the only situation we poll in.
  it('refreshes when the tab is visible and no input modal is open', () => {
    expect(shouldAutoRefresh({ inputOpen: false, tabHidden: false })).toBe(true);
  });

  // Unhappy paths: every reason to hold off.
  it('does not refresh while an input modal is open (would clobber typing)', () => {
    expect(shouldAutoRefresh({ inputOpen: true, tabHidden: false })).toBe(false);
  });

  it('does not refresh while the tab is hidden (no one is looking)', () => {
    expect(shouldAutoRefresh({ inputOpen: false, tabHidden: true })).toBe(false);
  });

  it('does not refresh when both hidden and an input modal is open', () => {
    expect(shouldAutoRefresh({ inputOpen: true, tabHidden: true })).toBe(false);
  });
});

describe('AUTO_REFRESH_INTERVAL_MS', () => {
  it('is a sane polling cadence (1s–30s)', () => {
    expect(AUTO_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(1_000);
    expect(AUTO_REFRESH_INTERVAL_MS).toBeLessThanOrEqual(30_000);
  });
});
