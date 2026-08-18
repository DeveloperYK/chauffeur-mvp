import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { checkDatabase } from '@/server/services/health';
import { NextResponse } from 'next/server';

// Health checks must reflect the live server, never a cached copy: the old
// force-static version let Vercel's edge serve days-old "ok" bodies, so a
// down app or database still looked healthy to monitoring.
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(): Promise<Response> {
  const ts = new Date().toISOString();
  const url = env().DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { ok: false, db: 'unconfigured', ts },
      { status: 503, headers: NO_STORE },
    );
  }
  const { db } = getDb(url);
  const dbUp = await checkDatabase(db);
  return NextResponse.json(
    { ok: dbUp, db: dbUp ? 'up' : 'down', ts },
    { status: dbUp ? 200 : 503, headers: NO_STORE },
  );
}
