import { logger } from '@/lib/logger';
import type { Database } from '@/server/db';
import { auditEvents } from '@/server/db/schema';
import { type Clock, systemClock } from '@/server/ports/clock';
import { and, desc, eq, gt } from 'drizzle-orm';
import { type BoardPathResult, checkBoardPath } from './health';

/** Audit action recorded for every self-heal attempt (success or not). */
export const SELF_HEAL_ACTION = 'self_heal_redeploy';
/** Sentinel entity the audit rows hang off: "the production deployment". */
export const SELF_HEAL_ENTITY_ID = '00000000-0000-4000-8000-000000000001';
export const SELF_HEAL_ENTITY_TYPE = 'deployment';
/** Never trigger more than one redeploy per hour, whatever the probes say. */
export const SELF_HEAL_COOLDOWN_MS = 60 * 60 * 1000;
/** Gap between the two probes that confirm a stall. */
export const SELF_HEAL_CONFIRM_DELAY_MS = 15_000;
/** Ceiling on the deploy-hook call. */
export const SELF_HEAL_HOOK_TIMEOUT_MS = 10_000;

export interface SelfHealDeps {
  db: Database;
  /** Vercel Deploy Hook URL for the production branch; unset disables self-heal. */
  hookUrl: string | undefined;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /** Board readiness probe; defaults to `checkBoardPath`. Injectable for tests. */
  probe?: () => Promise<BoardPathResult>;
  sleep?: (ms: number) => Promise<void>;
  confirmDelayMs?: number;
}

export type SelfHealReport =
  | { action: 'skipped'; reason: 'disabled' }
  | { action: 'skipped'; reason: 'healthy'; ms: number }
  | { action: 'skipped'; reason: 'recovered'; first: BoardPathResult }
  | { action: 'skipped'; reason: 'cooldown'; lastAttemptAt: Date }
  | { action: 'redeployed'; hookStatus: number; probe: BoardPathResult }
  | { action: 'hook_failed'; hookStatus: number | null; message: string; probe: BoardPathResult };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function lastAttemptSince(db: Database, since: Date): Promise<Date | null> {
  const rows = await db
    .select({ createdAt: auditEvents.createdAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.action, SELF_HEAL_ACTION), gt(auditEvents.createdAt, since)))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

async function recordAttempt(
  db: Database,
  now: Date,
  probe: BoardPathResult,
  hookStatus: number | null,
  message: string | null,
): Promise<void> {
  const failure = probe.ok ? null : { reason: probe.reason, message: probe.message, ms: probe.ms };
  await db.insert(auditEvents).values({
    actorType: 'system',
    actorId: null,
    entityType: SELF_HEAL_ENTITY_TYPE,
    entityId: SELF_HEAL_ENTITY_ID,
    action: SELF_HEAL_ACTION,
    before: failure as never,
    after: { ...failure, hookStatus, hookError: message } as never,
    createdAt: now,
  });
}

/**
 * Self-heal a stalled board path by redeploying production.
 *
 * Why: on 8–9 Sep 2026 the board's queries stalled inside the database pooler
 * for 26 hours while the liveness probe stayed green; a redeploy (fresh
 * function instances) is the remediation that has worked. Runs from the clock
 * tick, inside Vercel, so it needs no external agent and no open egress.
 *
 * Guards, in order: disabled without a hook URL; at most one attempt per
 * `SELF_HEAL_COOLDOWN_MS` (checked BEFORE probing, from the audit log, so a
 * cooling instance costs nothing); two failing probes `confirmDelayMs` apart.
 * Every attempt — success or not — writes an audit row and starts the cooldown.
 * Never throws: the caller is the cron, which must keep ticking.
 */
export async function selfHealRedeploy(deps: SelfHealDeps): Promise<SelfHealReport> {
  const { db, hookUrl } = deps;
  if (!hookUrl || !/^https?:\/\//i.test(hookUrl)) return { action: 'skipped', reason: 'disabled' };
  const clock = deps.clock ?? systemClock;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const probe = deps.probe ?? (() => checkBoardPath(db));
  const sleep = deps.sleep ?? defaultSleep;
  const now = clock.now();

  const lastAttemptAt = await lastAttemptSince(db, new Date(now.getTime() - SELF_HEAL_COOLDOWN_MS));
  if (lastAttemptAt) return { action: 'skipped', reason: 'cooldown', lastAttemptAt };

  const first = await probe();
  if (first.ok) return { action: 'skipped', reason: 'healthy', ms: first.ms };

  await sleep(deps.confirmDelayMs ?? SELF_HEAL_CONFIRM_DELAY_MS);
  const second = await probe();
  if (second.ok) {
    logger.warn({ first }, 'board path blipped but recovered — no self-heal');
    return { action: 'skipped', reason: 'recovered', first };
  }

  logger.error({ first, second }, 'board path stall confirmed — triggering production redeploy');
  try {
    const res = await fetchImpl(hookUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(SELF_HEAL_HOOK_TIMEOUT_MS),
    });
    await recordAttempt(db, clock.now(), second, res.status, res.ok ? null : 'non-2xx');
    if (!res.ok) {
      logger.error({ status: res.status }, 'self-heal deploy hook rejected');
      return {
        action: 'hook_failed',
        hookStatus: res.status,
        message: `hook returned ${res.status}`,
        probe: second,
      };
    }
    logger.warn({ status: res.status }, 'self-heal redeploy triggered');
    return { action: 'redeployed', hookStatus: res.status, probe: second };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordAttempt(db, clock.now(), second, null, message);
    logger.error({ err }, 'self-heal deploy hook call failed');
    return { action: 'hook_failed', hookStatus: null, message, probe: second };
  }
}
