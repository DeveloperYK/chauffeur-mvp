import { type Env, env } from '@/lib/env';

/**
 * The test simulator is always available outside production; in production it
 * is gated behind SIMULATOR_ENABLED so only deliberate demo deploys expose it.
 * Pure over its inputs so it can be unit-tested without touching process.env.
 */
export function isSimulatorEnabled(e: Pick<Env, 'NODE_ENV' | 'SIMULATOR_ENABLED'>): boolean {
  return e.NODE_ENV !== 'production' || e.SIMULATOR_ENABLED;
}

/** Runtime check using the validated environment. */
export function simulatorEnabled(): boolean {
  return isSimulatorEnabled(env());
}
