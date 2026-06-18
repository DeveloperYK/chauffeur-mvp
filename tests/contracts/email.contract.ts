/**
 * Contract tests for EmailPort implementations. The same suite runs against
 * FakeEmailAdapter and ResendEmailAdapter so the in-memory double can't drift
 * from the real provider's observable behaviour.
 */
import type { EmailPort } from '@/server/ports/email';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

export function emailContractTests(createAdapter: () => EmailPort, cleanup?: () => void) {
  describe('EmailPort contract', () => {
    let adapter: EmailPort;

    beforeEach(() => {
      adapter = createAdapter();
    });

    afterEach(() => {
      cleanup?.();
    });

    it('returns ok:true with a non-empty id for a valid email', async () => {
      const result = await adapter.sendEmail({
        to: 'exec@example.com',
        subject: 'Chauffeur MVP - BKNG-00001',
        text: 'Your driver is confirmed.',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(typeof result.id).toBe('string');
        expect(result.id.length).toBeGreaterThan(0);
      }
    });

    it('rejects a recipient with no @ as invalid_to', async () => {
      const result = await adapter.sendEmail({ to: 'not-an-email', subject: 's', text: 't' });
      expect(result).toEqual({ ok: false, reason: 'invalid_to' });
    });

    it('rejects an empty subject', async () => {
      const result = await adapter.sendEmail({ to: 'exec@example.com', subject: '', text: 't' });
      expect(result).toEqual({ ok: false, reason: 'empty_subject' });
    });

    it('rejects an empty body', async () => {
      const result = await adapter.sendEmail({ to: 'exec@example.com', subject: 's', text: '' });
      expect(result).toEqual({ ok: false, reason: 'empty_body' });
    });
  });
}
