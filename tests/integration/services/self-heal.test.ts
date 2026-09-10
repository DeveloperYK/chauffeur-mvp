import { auditEvents } from '@/server/db/schema';
import { TestClock } from '@/server/ports/clock';
import type { BoardPathResult } from '@/server/services/health';
import {
  SELF_HEAL_ACTION,
  SELF_HEAL_COOLDOWN_MS,
  type SelfHealDeps,
  selfHealRedeploy,
} from '@/server/services/self-heal';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TestDb, createTestDb } from '~test/helpers/pglite-db';

// The 8–9 Sep outage: the board's queries stalled inside the pooler for 26 h
// while healthz stayed green. A redeploy replaces every function instance and
// cleared it. This service lets the clock tick do that itself — only on a
// CONFIRMED stall (two probes, 15 s apart), at most once an hour, always with
// an audit row — so nobody has to wake up to press the button.

const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_x/hook_y';
const T0 = '2026-09-10T22:00:00.000Z';

const ok: BoardPathResult = { ok: true, ms: 40 };
const stalled: BoardPathResult = {
  ok: false,
  reason: 'timeout',
  ms: 5000,
  message: 'Database work "readiness board path" did not finish within 5000 ms',
};
const broken: BoardPathResult = {
  ok: false,
  reason: 'error',
  ms: 12,
  message: 'column "requested_car_type" does not exist',
};

function probeSequence(...results: BoardPathResult[]) {
  const queue = [...results];
  const calls: number[] = [];
  const probe = vi.fn(async () => {
    calls.push(Date.now());
    const next = queue.shift();
    if (!next) throw new Error('probe called more times than expected');
    return next;
  });
  return probe;
}

describe('services/self-heal (integration)', () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let clock: TestClock;
  let fetchImpl: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const t = await createTestDb();
    db = t.db;
    close = t.close;
  });
  afterAll(async () => {
    await close();
  });
  beforeEach(async () => {
    await db.delete(auditEvents);
    clock = new TestClock(T0);
    fetchImpl = vi.fn(
      async () => new Response('{"job":{"id":"j1","state":"PENDING"}}', { status: 201 }),
    );
    sleep = vi.fn(async () => {});
  });

  const deps = (over: Partial<SelfHealDeps>): SelfHealDeps => ({
    db,
    hookUrl: HOOK,
    clock,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    ...over,
  });

  async function lastAudit() {
    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, SELF_HEAL_ACTION))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  it('is disabled when no hook URL is configured — never probes, never calls', async () => {
    const probe = probeSequence();
    const r = await selfHealRedeploy(deps({ hookUrl: undefined, probe }));
    expect(r).toEqual({ action: 'skipped', reason: 'disabled' });
    expect(probe).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does nothing when the board path is healthy', async () => {
    const probe = probeSequence(ok);
    const r = await selfHealRedeploy(deps({ probe }));
    expect(r).toMatchObject({ action: 'skipped', reason: 'healthy' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await lastAudit()).toBeNull();
  });

  it('waits and re-probes; a blip that recovers is not a stall', async () => {
    const probe = probeSequence(stalled, ok);
    const r = await selfHealRedeploy(deps({ probe }));
    expect(r).toMatchObject({ action: 'skipped', reason: 'recovered' });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await lastAudit()).toBeNull();
  });

  it('fires the deploy hook once on a confirmed stall and records an audit row', async () => {
    const probe = probeSequence(stalled, stalled);
    const r = await selfHealRedeploy(deps({ probe }));
    expect(r).toMatchObject({ action: 'redeployed', hookStatus: 201 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(HOOK);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const audit = await lastAudit();
    expect(audit?.actorType).toBe('system');
    expect(audit?.after).toMatchObject({ reason: 'timeout', hookStatus: 201 });
  });

  it('also treats a persistent query error as a stall (a redeploy re-runs migrations)', async () => {
    const probe = probeSequence(broken, broken);
    const r = await selfHealRedeploy(deps({ probe }));
    expect(r).toMatchObject({ action: 'redeployed' });
    expect((await lastAudit())?.after).toMatchObject({ reason: 'error' });
  });

  it('refuses a second redeploy inside the cooldown window', async () => {
    await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    clock.advanceMinutes(20);
    const r = await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    expect(r).toMatchObject({ action: 'skipped', reason: 'cooldown' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('may redeploy again once the cooldown has elapsed', async () => {
    await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    clock.advanceBy(SELF_HEAL_COOLDOWN_MS + 1000);
    const r = await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    expect(r).toMatchObject({ action: 'redeployed' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('checks the cooldown before probing, so a cooling instance does not burn 20 s per tick', async () => {
    await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    const probe = probeSequence();
    const r = await selfHealRedeploy(deps({ probe }));
    expect(r).toMatchObject({ action: 'skipped', reason: 'cooldown' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('reports a rejected hook without throwing and still starts the cooldown', async () => {
    fetchImpl.mockResolvedValueOnce(new Response('nope', { status: 403 }));
    const r = await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    expect(r).toMatchObject({ action: 'hook_failed', hookStatus: 403 });
    expect((await lastAudit())?.after).toMatchObject({ hookStatus: 403 });
    const again = await selfHealRedeploy(deps({ probe: probeSequence() }));
    expect(again).toMatchObject({ action: 'skipped', reason: 'cooldown' });
  });

  it('reports a network failure on the hook as a value, not an exception', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('ECONNRESET'));
    const r = await selfHealRedeploy(deps({ probe: probeSequence(stalled, stalled) }));
    expect(r).toMatchObject({ action: 'hook_failed' });
    if (r.action === 'hook_failed') expect(r.message).toContain('ECONNRESET');
  });

  it('refuses a non-http(s) hook URL', async () => {
    const probe = probeSequence();
    const r = await selfHealRedeploy(deps({ hookUrl: 'ftp://x/y', probe }));
    expect(r).toEqual({ action: 'skipped', reason: 'disabled' });
    expect(probe).not.toHaveBeenCalled();
  });
});
