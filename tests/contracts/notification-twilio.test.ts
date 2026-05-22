/**
 * Contract tests for TwilioNotificationAdapter.
 *
 * Uses a mock fetch to verify the adapter's behavior matches the contract
 * without making real HTTP calls.
 */

import { TwilioNotificationAdapter } from '@/server/adapters/notification-twilio';
import { describe, vi } from 'vitest';
import { notificationContractTests } from './notification.contract';

describe('TwilioNotificationAdapter', () => {
  let messageIdCounter = 1;

  const mockFetchImpl = async (
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = init?.body?.toString() ?? '';
    const params = new URLSearchParams(body);
    const toNumber = params.get('To') ?? '';

    if (!toNumber.startsWith('+')) {
      return new Response(JSON.stringify({ message: 'Invalid To number' }), {
        status: 400,
      });
    }

    const sid = `SM${messageIdCounter++}`;
    return new Response(JSON.stringify({ sid, status: 'queued' }), {
      status: 201,
    });
  };

  const mockFetch = vi.fn(mockFetchImpl);

  notificationContractTests(
    () => {
      messageIdCounter = 1;
      mockFetch.mockClear();

      return new TwilioNotificationAdapter({
        accountSid: 'ACtest123',
        authToken: 'test-auth-token',
        fromNumber: '+15551234567',
        fetchImpl: mockFetch as typeof fetch,
      });
    },
    () => {
      mockFetch.mockClear();
    },
  );
});
