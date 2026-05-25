import { parseMonthString } from '@/lib/dates';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { reconcile, reconciliationCsv } from '@/server/domain/reconcile';
import { listBillableBookings } from '@/server/services/bookings-query';
import { type NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** GET /dashboard/invoicing/export?month=YYYY-MM → CSV download of the month's reconciliation. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await currentSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const url = env().DATABASE_URL;
  if (!url) return new NextResponse('Server not configured', { status: 500 });

  const month = request.nextUrl.searchParams.get('month') ?? '';
  if (!parseMonthString(month)) {
    return new NextResponse('Invalid month (expected YYYY-MM)', { status: 400 });
  }

  const { db } = getDb(url);
  const bookings = await listBillableBookings(db, month);
  const csv = reconciliationCsv(reconcile(bookings));

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="reconciliation-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
