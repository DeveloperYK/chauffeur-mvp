import { logger } from '@/lib/logger';
import { db, notifications } from '@/server/composition';
import { clockTick } from '@/server/services/clock-tick';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SHARED_SECRET_HEADER = 'x-clock-secret';

/**
 * Triggered by an external scheduler (cron / Vercel Cron / GitHub Actions / etc.)
 * once per minute. Authenticates via the CLOCK_TICK_SECRET env var.
 *
 * Returns the per-tick report; 401 if the shared secret is wrong or unset.
 */
export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CLOCK_TICK_SECRET;
  if (!expected) {
    return new NextResponse('clock tick disabled', { status: 503 });
  }
  const provided = request.headers.get(SHARED_SECRET_HEADER);
  if (!provided || provided !== expected) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  try {
    const report = await clockTick({ db: db(), notifications: notifications() });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    logger.error({ err }, 'clock tick failed');
    return new NextResponse('internal error', { status: 500 });
  }
}
