import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { db, email, notifications } from '@/server/composition';
import { authorizeCronRequest } from '@/server/domain/cron-auth';
import { clockTick } from '@/server/services/clock-tick';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SHARED_SECRET_HEADER = 'x-clock-secret';

/** Run one clock tick and return the per-tick report, mapping failures to 500. */
async function runTick(): Promise<Response> {
  try {
    const report = await clockTick({ db: db(), notifications: notifications(), email: email() });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    logger.error({ err }, 'clock tick failed');
    return new NextResponse('internal error', { status: 500 });
  }
}

/**
 * Production scheduler entrypoint: Vercel Cron calls this once per minute (see
 * the `crons` entry in vercel.json) with `Authorization: Bearer <CRON_SECRET>`.
 *
 * 503 if no CRON_SECRET is configured, 401 if the Bearer token is missing/wrong.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = authorizeCronRequest(request.headers.get('authorization'), env().CRON_SECRET);
  if (!auth.ok) {
    return new NextResponse(auth.message, { status: auth.status });
  }
  return runTick();
}

/**
 * Manual / external-scheduler entrypoint. Authenticates via the CLOCK_TICK_SECRET
 * env var passed in the `x-clock-secret` header. Kept as an escape hatch for
 * triggering a tick outside Vercel Cron (e.g. local ops, a backup scheduler).
 *
 * Returns the per-tick report; 401 if the shared secret is wrong or unset.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = env().CLOCK_TICK_SECRET;
  if (!expected) {
    return new NextResponse('clock tick disabled', { status: 503 });
  }
  const provided = request.headers.get(SHARED_SECRET_HEADER);
  if (!provided || provided !== expected) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  return runTick();
}
