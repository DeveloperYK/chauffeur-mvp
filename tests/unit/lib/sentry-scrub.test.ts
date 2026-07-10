import { scrubSentryEvent } from '@/lib/observability/scrub';
import { describe, expect, it } from 'vitest';

const REDACTED = '[redacted]';

describe('scrubSentryEvent', () => {
  describe('passthrough (no PII)', () => {
    it('returns null/undefined unchanged', () => {
      expect(scrubSentryEvent(null)).toBeNull();
      expect(scrubSentryEvent(undefined)).toBeUndefined();
    });

    it('leaves a clean event untouched', () => {
      const event = {
        level: 'error',
        transaction: 'GET /dashboard',
        exception: { values: [{ type: 'Error', value: 'boom' }] },
        tags: { route: 'dashboard', bookingId: 'bk_123' },
      };
      expect(scrubSentryEvent(event)).toEqual(event);
    });

    it('does not mutate the input event', () => {
      const event = {
        request: { headers: { cookie: 'session=abc' } },
        user: { id: 'op_1', email: 'a@b.com' },
      };
      const snapshot = structuredClone(event);
      scrubSentryEvent(event);
      expect(event).toEqual(snapshot);
    });
  });

  describe('request scrubbing', () => {
    it('drops cookies entirely', () => {
      const out = scrubSentryEvent({
        request: { cookies: { session: 'secret-session' } },
      });
      expect(out.request).not.toHaveProperty('cookies');
    });

    it('redacts cookie / authorization / clock-secret headers, keeps benign ones', () => {
      const out = scrubSentryEvent({
        request: {
          headers: {
            cookie: 'session=abc',
            Authorization: 'Bearer xyz',
            'x-clock-secret': 'topsecret',
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0',
          },
        },
      });
      expect(out.request.headers).toEqual({
        cookie: REDACTED,
        Authorization: REDACTED,
        'x-clock-secret': REDACTED,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
      });
    });

    it('redacts the driver-link JWT in the request URL', () => {
      const out = scrubSentryEvent({
        request: {
          url: 'https://app.example.com/j/eyJhbGciOiJIUzI1NiJ9.payload.sig?ref=sms',
        },
      });
      expect(out.request.url).toBe('https://app.example.com/j/[token]?ref=sms');
    });

    it('redacts sensitive query-string parameters', () => {
      const out = scrubSentryEvent({
        request: {
          query_string: 'page=2&token=abc123&email=a%40b.com&sort=asc',
        },
      });
      expect(out.request.query_string).toBe(`page=2&token=${REDACTED}&email=${REDACTED}&sort=asc`);
    });

    it('deep-redacts sensitive keys in the request body', () => {
      const out = scrubSentryEvent({
        request: {
          data: {
            bookingId: 'bk_1',
            driverPhone: '+447700900000',
            password: 'hunter2',
            nested: { execEmail: 'vip@example.com', city: 'London' },
          },
        },
      });
      expect(out.request.data).toEqual({
        bookingId: 'bk_1',
        driverPhone: REDACTED,
        password: REDACTED,
        nested: { execEmail: REDACTED, city: 'London' },
      });
    });
  });

  describe('user scrubbing', () => {
    it('keeps only the user id, dropping email / username / ip', () => {
      const out = scrubSentryEvent({
        user: {
          id: 'op_42',
          email: 'op@example.com',
          username: 'alice',
          ip_address: '203.0.113.5',
        },
      });
      expect(out.user).toEqual({ id: 'op_42' });
    });

    it('returns an empty user object when there is no id', () => {
      const out = scrubSentryEvent({
        user: { email: 'op@example.com', ip_address: '203.0.113.5' },
      });
      expect(out.user).toEqual({});
    });
  });

  describe('extra / contexts / tags / breadcrumbs', () => {
    it('deep-redacts sensitive keys across extra and contexts, including arrays', () => {
      const out = scrubSentryEvent({
        extra: {
          recipients: [
            { name: 'A', phone: '+447700900001' },
            { name: 'B', phone: '+447700900002' },
          ],
          twilioAuthToken: 'should-vanish',
        },
        contexts: { sms: { toNumber: '+447700900003', body: 'Your car' } },
      });
      expect(out.extra).toEqual({
        recipients: [
          { name: 'A', phone: REDACTED },
          { name: 'B', phone: REDACTED },
        ],
        twilioAuthToken: REDACTED,
      });
      // body is benign and preserved; only the explicitly-sensitive keys go
      expect(out.contexts.sms.body).toBe('Your car');
    });

    it('sanitizes URLs and redacts data inside breadcrumbs', () => {
      const out = scrubSentryEvent({
        breadcrumbs: [
          {
            category: 'navigation',
            message: 'navigate to /j/eyJabc.def.ghi',
            data: { authorization: 'Bearer leak', ok: true },
          },
        ],
      });
      const crumb = out.breadcrumbs[0];
      expect(crumb?.message).toBe('navigate to /j/[token]');
      expect(crumb?.data).toEqual({
        authorization: REDACTED,
        ok: true,
      });
    });

    it('sanitizes the transaction name', () => {
      const out = scrubSentryEvent({
        transaction: 'GET /j/eyJabc.def.ghi',
      });
      expect(out.transaction).toBe('GET /j/[token]');
    });
  });
});
