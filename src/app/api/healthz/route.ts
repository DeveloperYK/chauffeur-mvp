import { NextResponse } from 'next/server';

export const dynamic = 'force-static';
export const revalidate = 60;

export function GET(): Response {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
