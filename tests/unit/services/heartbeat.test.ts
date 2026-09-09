import { pingHeartbeat } from '@/server/services/heartbeat';
import { describe, expect, it, vi } from 'vitest';

// The clock tick pings an external heartbeat URL after each successful run so
// an uptime monitor can alert when the cron silently stops. The ping must
// never affect the tick: no URL means no call, and a failing ping is swallowed.

const okFetch = () => vi.fn(async () => new Response('ok', { status: 200 }));

describe('pingHeartbeat', () => {
  it('GETs the heartbeat URL and reports success', async () => {
    const fetchImpl = okFetch();
    await expect(pingHeartbeat('https://hb.example/abc', fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hb.example/abc');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('sends the call with an abort signal so a hung monitor cannot stall the tick', async () => {
    const fetchImpl = okFetch();
    await pingHeartbeat('https://hb.example/abc', fetchImpl);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('accepts any 2xx as delivered', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(pingHeartbeat('https://hb.example/abc', fetchImpl)).resolves.toBe(true);
  });

  it('does nothing when no URL is configured', async () => {
    const fetchImpl = okFetch();
    await expect(pingHeartbeat(undefined, fetchImpl)).resolves.toBe(false);
    await expect(pingHeartbeat('', fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports false on a non-2xx response without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(pingHeartbeat('https://hb.example/abc', fetchImpl)).resolves.toBe(false);
  });

  it('reports false when the network call throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await expect(pingHeartbeat('https://hb.example/abc', fetchImpl)).resolves.toBe(false);
  });

  it('refuses a non-http(s) URL rather than calling it', async () => {
    const fetchImpl = okFetch();
    await expect(pingHeartbeat('ftp://hb.example/abc', fetchImpl)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
