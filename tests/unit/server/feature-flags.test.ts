import { isSimulatorEnabled } from '@/server/feature-flags';
import { describe, expect, it } from 'vitest';

describe('isSimulatorEnabled', () => {
  it('is on outside production regardless of the flags', () => {
    expect(
      isSimulatorEnabled({
        NODE_ENV: 'development',
        SIMULATOR_ENABLED: false,
        AUTH_DISABLED: false,
      }),
    ).toBe(true);
    expect(
      isSimulatorEnabled({ NODE_ENV: 'test', SIMULATOR_ENABLED: false, AUTH_DISABLED: false }),
    ).toBe(true);
  });

  it('is OFF in real production even when SIMULATOR_ENABLED is set (auth is enforced there)', () => {
    // The defining property: the simulator can never appear where real operator
    // login is enforced, because that is where real data lives and its
    // "Reset all data" action is catastrophic. Production has AUTH_DISABLED off.
    expect(
      isSimulatorEnabled({ NODE_ENV: 'production', SIMULATOR_ENABLED: true, AUTH_DISABLED: false }),
    ).toBe(false);
    expect(
      isSimulatorEnabled({
        NODE_ENV: 'production',
        SIMULATOR_ENABLED: false,
        AUTH_DISABLED: false,
      }),
    ).toBe(false);
  });

  it('is on in a production build only when opted in AND auth is disabled (staging / demo / CI lifecycle)', () => {
    expect(
      isSimulatorEnabled({ NODE_ENV: 'production', SIMULATOR_ENABLED: true, AUTH_DISABLED: true }),
    ).toBe(true);
  });

  it('stays off in a production build when auth is disabled but not opted in', () => {
    expect(
      isSimulatorEnabled({ NODE_ENV: 'production', SIMULATOR_ENABLED: false, AUTH_DISABLED: true }),
    ).toBe(false);
  });
});
