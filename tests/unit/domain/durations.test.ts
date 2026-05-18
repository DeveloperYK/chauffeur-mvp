import {
  completionLinkExpiry,
  dispatchLinkExpiry,
  expectedEndAt,
  inProgressDueAt,
} from '@/server/domain/durations';
import { describe, expect, it } from 'vitest';

const PICKUP = new Date('2026-05-20T10:00:00.000Z');

describe('durations', () => {
  it('inProgressDueAt = pickup - 1h', () => {
    expect(inProgressDueAt(PICKUP).toISOString()).toBe('2026-05-20T09:00:00.000Z');
  });

  it('expectedEndAt(pickup, 90 min) = pickup + 90 min', () => {
    expect(expectedEndAt(PICKUP, 90).toISOString()).toBe('2026-05-20T11:30:00.000Z');
  });

  it('dispatchLinkExpiry = pickup + 2 days', () => {
    expect(dispatchLinkExpiry(PICKUP).toISOString()).toBe('2026-05-22T10:00:00.000Z');
  });

  it('completionLinkExpiry = pickup + 7 days', () => {
    expect(completionLinkExpiry(PICKUP).toISOString()).toBe('2026-05-27T10:00:00.000Z');
  });
});
