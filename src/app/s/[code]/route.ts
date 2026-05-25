import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { resolveShortLink } from '@/server/services/short-links';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Branded short link: /s/<code> 302-redirects to the stored destination (the
 * long signed /j/<token> URL). Unknown codes 404. The redirect itself carries
 * no auth — the destination token gates access.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;
  const url = env().DATABASE_URL;
  if (!url) return new NextResponse('Server not configured', { status: 500 });

  const { db } = getDb(url);
  const destination = await resolveShortLink(db, code);
  if (!destination) return new NextResponse('Link not found', { status: 404 });

  return NextResponse.redirect(destination, 302);
}
