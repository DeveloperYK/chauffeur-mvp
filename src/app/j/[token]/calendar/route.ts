import { bookingRef } from '@/lib/booking-ref';
import { driverJobIcs } from '@/lib/ics';
import { appUrl, db, driverLinkSecret } from '@/server/composition';
import { previewDriverJob } from '@/server/services/dispatch';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * .ics download for the driver's accepted job — the Apple Calendar counterpart
 * to the Google Calendar link. Gated exactly like the job view: the signed,
 * unexpired dispatch token must belong to the booking's CURRENT assigned
 * driver, so a losing fan-out offer or a released driver gets a 404, not an
 * event file.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const job = await previewDriverJob(token, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
  });
  if (!job.ok) return new NextResponse('Not found', { status: 404 });

  const jobUrl = `${appUrl().replace(/\/+$/, '')}/j/${token}`;
  const ics = driverJobIcs(job.booking, jobUrl);
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="jj-${bookingRef(job.booking.seq)}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
