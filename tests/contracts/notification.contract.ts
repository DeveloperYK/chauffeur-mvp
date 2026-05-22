/**
 * Contract tests for NotificationPort implementations.
 *
 * These tests verify that both FakeNotificationAdapter and TwilioNotificationAdapter
 * exhibit identical behavior for the same inputs.
 *
 * Run against both implementations to ensure behavioral equivalence.
 */

import type { NotificationPort, SmsMessage } from '@/server/ports/notifications';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Shared contract test suite for any NotificationPort implementation.
 *
 * @param createAdapter Factory function that creates a fresh adapter instance
 * @param cleanup Optional cleanup function called after each test
 */
export function notificationContractTests(
  createAdapter: () => NotificationPort,
  cleanup?: () => void,
) {
  describe('NotificationPort contract', () => {
    let adapter: NotificationPort;

    beforeEach(() => {
      adapter = createAdapter();
    });

    afterEach(() => {
      cleanup?.();
    });

    // ─── Happy Paths ──────────────────────────────────────────────────────────

    describe('valid SMS', () => {
      it('returns ok:true with id for valid E.164 UK mobile', async () => {
        const msg: SmsMessage = {
          to: '+447911123456',
          body: 'Your driver Tom is on the way.',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(typeof result.id).toBe('string');
          expect(result.id.length).toBeGreaterThan(0);
        }
      });

      it('returns ok:true with id for valid E.164 US number', async () => {
        const msg: SmsMessage = {
          to: '+15551234567',
          body: 'Test message',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(true);
      });

      it('returns ok:true for max length body (1600 chars)', async () => {
        const msg: SmsMessage = {
          to: '+447911123456',
          body: 'x'.repeat(1600),
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(true);
      });

      it('returns ok:true for minimal body (1 char)', async () => {
        const msg: SmsMessage = {
          to: '+447911123456',
          body: 'X',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(true);
      });
    });

    // ─── Unhappy Paths ────────────────────────────────────────────────────────

    describe('invalid phone number', () => {
      it('returns ok:false for number without + prefix', async () => {
        const msg: SmsMessage = {
          to: '447911123456',
          body: 'Test message',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('invalid_to');
        }
      });

      it('returns ok:false for empty phone number', async () => {
        const msg: SmsMessage = {
          to: '',
          body: 'Test message',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(false);
      });
    });

    describe('invalid body', () => {
      it('returns ok:false for empty body', async () => {
        const msg: SmsMessage = {
          to: '+447911123456',
          body: '',
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('empty_body');
        }
      });

      it('returns ok:false for body exceeding 1600 chars', async () => {
        const msg: SmsMessage = {
          to: '+447911123456',
          body: 'x'.repeat(1601),
        };

        const result = await adapter.sendSms(msg);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.reason).toBe('body_too_long');
        }
      });
    });

    // ─── Idempotency & Consistency ────────────────────────────────────────────

    describe('consistency', () => {
      it('returns different IDs for different messages', async () => {
        const msg1: SmsMessage = { to: '+447911123456', body: 'Message 1' };
        const msg2: SmsMessage = { to: '+447911123456', body: 'Message 2' };

        const result1 = await adapter.sendSms(msg1);
        const result2 = await adapter.sendSms(msg2);

        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
        if (result1.ok && result2.ok) {
          expect(result1.id).not.toBe(result2.id);
        }
      });
    });
  });
}
