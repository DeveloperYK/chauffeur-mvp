import { isSimulatorEnabled } from '@/server/feature-flags';
import { describe, expect, it } from 'vitest';

describe('isSimulatorEnabled', () => {
  it('is on outside production regardless of the flag', () => {
    expect(isSimulatorEnabled({ NODE_ENV: 'development', SIMULATOR_ENABLED: false })).toBe(true);
    expect(isSimulatorEnabled({ NODE_ENV: 'test', SIMULATOR_ENABLED: false })).toBe(true);
  });

  it('is off in production unless the flag is set', () => {
    expect(isSimulatorEnabled({ NODE_ENV: 'production', SIMULATOR_ENABLED: false })).toBe(false);
  });

  it('is on in production when the flag is set (demo deploys)', () => {
    expect(isSimulatorEnabled({ NODE_ENV: 'production', SIMULATOR_ENABLED: true })).toBe(true);
  });
});
