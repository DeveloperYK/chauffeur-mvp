import { POOL_OPTIONS } from '@/server/db';
import { describe, expect, it } from 'vitest';

/**
 * Production runs through Supabase's session pooler, which admits at most 30
 * client connections in total (ADR 0015). Every Vercel function instance —
 * including the previous deployment's instances, which linger frozen for
 * minutes after a deploy, across two regions — holds up to `max` of them.
 * On 2026-10-11 a routine deploy pushed the total past 30 and took the board
 * and the clock tick down for six minutes. Keep the per-instance share small.
 */
describe('db POOL_OPTIONS (session-pooler budget)', () => {
  const SESSION_POOLER_CLIENTS = 30;
  const INSTANCES_TO_SURVIVE = 12;

  it('holds at most 2 pooler slots per instance', () => {
    expect(POOL_OPTIONS.max).toBeLessThanOrEqual(2);
  });

  it('lets a dozen live instances fit inside the pooler cap', () => {
    expect(POOL_OPTIONS.max * INSTANCES_TO_SURVIVE).toBeLessThanOrEqual(SESSION_POOLER_CLIENTS);
  });

  it('releases idle sockets quickly so a cooling instance gives slots back', () => {
    expect(POOL_OPTIONS.idle_timeout).toBeLessThanOrEqual(20);
  });
});
