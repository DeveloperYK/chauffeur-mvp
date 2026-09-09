import { env } from '@/lib/env';
import { getDb, resetDb } from '@/server/db';
import { checkBoardPath } from '@/server/services/health';
import { NextResponse } from 'next/server';

// Deep readiness probe for uptime monitoring: runs the board's real queries
// under a 5 s budget. 200 when the board would render, 503 otherwise. Unlike
// /api/healthz it fails when the pooler stalls, which is the outage operators
// actually see. Never cached; a stale "ok" defeats the purpose.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(): Promise<Response> {
  const ts = new Date().toISOString();
  const url = env().DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { ok: false, reason: 'error', message: 'database unconfigured', ms: 0, ts },
      { status: 503, headers: NO_STORE },
    );
  }
  const { db } = getDb(url);
  const result = await checkBoardPath(db);
  // A stalled pool is the failure this probe exists to catch; tear it down so
  // the instance self-heals rather than failing every subsequent request.
  if (!result.ok && result.reason === 'timeout') await resetDb();
  return NextResponse.json({ ...result, ts }, { status: result.ok ? 200 : 503, headers: NO_STORE });
}
