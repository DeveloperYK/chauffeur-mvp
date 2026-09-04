import { type Env, env } from '@/lib/env';

/**
 * The test simulator is always available outside production. In a production
 * build it is exposed only when the deploy has BOTH opted in (SIMULATOR_ENABLED)
 * AND disabled operator login (AUTH_DISABLED) — i.e. a throwaway demo/staging
 * environment. A real production environment enforces login (AUTH_DISABLED off),
 * so the simulator can never appear there. This is deliberate: the simulator's
 * "Reset all data" wipes bookings + drivers, so it must never sit where real
 * operator auth and real data live.
 *
 * Pure over its inputs so it can be unit-tested without touching process.env.
 */
export function isSimulatorEnabled(
  e: Pick<Env, 'NODE_ENV' | 'SIMULATOR_ENABLED' | 'AUTH_DISABLED'>,
): boolean {
  if (e.NODE_ENV !== 'production') return true;
  return e.SIMULATOR_ENABLED && e.AUTH_DISABLED;
}

/** Runtime check using the validated environment. */
export function simulatorEnabled(): boolean {
  return isSimulatorEnabled(env());
}

/**
 * The "Generate" button on the new-booking modal fills the form with made-up
 * sample passengers, addresses and prices. It exists purely for testing, so it
 * follows the simulator's rule and can never appear in real production.
 */
export function isSampleGeneratorEnabled(
  e: Pick<Env, 'NODE_ENV' | 'SIMULATOR_ENABLED' | 'AUTH_DISABLED'>,
): boolean {
  return isSimulatorEnabled(e);
}

/** Runtime check using the validated environment. */
export function sampleGeneratorEnabled(): boolean {
  return isSampleGeneratorEnabled(env());
}
