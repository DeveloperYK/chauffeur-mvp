import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { PageContent, PageHeader } from '@/components/ui/page';
import { env } from '@/lib/env';
import { CAR_LABEL, STATE_BADGE, STATE_LABEL, TIER_LABEL } from '@/lib/labels';
import { getDb } from '@/server/db';
import { bookings } from '@/server/db/schema';
import { listActiveDrivers } from '@/server/services/drivers';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  approveAction,
  generateCompletionLinkAction,
  generateLinkAction,
  rejectAction,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ url?: string; wa?: string; error?: string }>;
}) {
  const { id } = await params;
  const search = await searchParams;
  const url = env().DATABASE_URL;
  if (!url) {
    return (
      <PageContent>
        <p className="text-danger-700">DATABASE_URL not configured.</p>
      </PageContent>
    );
  }
  const { db } = getDb(url);
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!booking) notFound();
  const driverList = await listActiveDrivers(db);

  return (
    <PageContent className="max-w-4xl">
      <PageHeader
        title={`${booking.passengerFirstName} ${booking.passengerLastName}`}
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Board
          </Link>
        }
        description={
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Badge className={STATE_BADGE[booking.state]}>{STATE_LABEL[booking.state]}</Badge>
            <span className="text-ink-muted">Pickup:</span>
            <span className="font-mono">
              {booking.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
            </span>
          </span>
        }
      />

      {search.error ? (
        <Alert tone="danger" className="mb-4">
          {decodeURIComponent(search.error)}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Trip</CardTitle>
          </CardHeader>
          <DefList>
            <DefItem label="From">{booking.pickupAddress}</DefItem>
            <DefItem label="To">{booking.dropoffAddress}</DefItem>
            <DefItem label="Duration">{booking.expectedDurationMinutes} minutes</DefItem>
            <DefItem label="Vehicle preference">{CAR_LABEL[booking.carTypePreference]}</DefItem>
            {booking.notes ? <DefItem label="Notes">{booking.notes}</DefItem> : null}
          </DefList>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Booking</CardTitle>
          </CardHeader>
          <DefList>
            <DefItem label="Booker">{booking.bookerName}</DefItem>
            <DefItem label="Account">{booking.accountCode}</DefItem>
            <DefItem label="Exec mobile">
              <code className="font-mono text-xs">{booking.execMobile}</code>
            </DefItem>
            <DefItem label="Contract price">
              £{(booking.contractPricePence / 100).toFixed(2)}
            </DefItem>
          </DefList>
        </Card>
      </div>

      {booking.state === 'unassigned' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Dispatch</CardTitle>
          </CardHeader>

          {search.url ? (
            <div className="space-y-3">
              <Alert tone="success">Driver link generated. Forward it via WhatsApp.</Alert>
              <div className="rounded border border-border bg-surface-sunken p-3">
                <p className="mb-1 text-xs font-semibold uppercase text-ink-subtle">Link</p>
                <a
                  href={decodeURIComponent(search.url)}
                  className="break-all font-mono text-xs text-brand-700 hover:underline"
                >
                  {decodeURIComponent(search.url)}
                </a>
              </div>
              {search.wa ? (
                <a
                  href={decodeURIComponent(search.wa)}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex items-center gap-2 rounded-md bg-success-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-success-700"
                >
                  Send via WhatsApp →
                </a>
              ) : null}
            </div>
          ) : (
            <form action={generateLinkAction} className="flex flex-col gap-3 sm:flex-row">
              <input type="hidden" name="bookingId" value={booking.id} />
              <Select name="driverId" required defaultValue="" className="sm:flex-1">
                <option value="" disabled>
                  Choose a driver…
                </option>
                {driverList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.tier === 'premium' ? '★ ' : ''}
                    {d.name} · {TIER_LABEL[d.tier]} · {CAR_LABEL[d.defaultCarType]}
                  </option>
                ))}
              </Select>
              <Button variant="primary" type="submit">
                Generate link
              </Button>
            </form>
          )}
        </Card>
      ) : null}

      {booking.state === 'awaiting_driver_form' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Awaiting driver completion form</CardTitle>
          </CardHeader>
          {search.url ? (
            <div className="space-y-3">
              <Alert tone="success">Completion link generated. Forward via WhatsApp.</Alert>
              <div className="rounded border border-border bg-surface-sunken p-3">
                <a
                  href={decodeURIComponent(search.url)}
                  className="break-all font-mono text-xs text-brand-700 hover:underline"
                >
                  {decodeURIComponent(search.url)}
                </a>
              </div>
              {search.wa ? (
                <a
                  href={decodeURIComponent(search.wa)}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="inline-flex items-center gap-2 rounded-md bg-success-500 px-3.5 py-2 text-sm font-medium text-white hover:bg-success-700"
                >
                  Send via WhatsApp →
                </a>
              ) : null}
            </div>
          ) : (
            <form action={generateCompletionLinkAction}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <Button variant="primary" type="submit">
                Generate completion link
              </Button>
            </form>
          )}
        </Card>
      ) : null}

      {booking.state === 'awaiting_operator_review' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Review submitted form</CardTitle>
          </CardHeader>
          <DefList>
            <DefItem label="Car park">£{((booking.carParkPence ?? 0) / 100).toFixed(2)}</DefItem>
            <DefItem label="Waiting time">{booking.waitingTimeMinutes ?? 0} minutes</DefItem>
            <DefItem label="Drop-off">
              {booking.dropoffAt
                ? `${booking.dropoffAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
                : '—'}
            </DefItem>
          </DefList>
          <div className="mt-4 flex gap-2 border-t border-border pt-4">
            <form action={approveAction}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <Button variant="success" type="submit">
                Approve
              </Button>
            </form>
            <form action={rejectAction}>
              <input type="hidden" name="bookingId" value={booking.id} />
              <Button variant="ghost" type="submit">
                Reject — driver to resubmit
              </Button>
            </form>
          </div>
        </Card>
      ) : null}

      {booking.state === 'assigned' || booking.state === 'in_progress' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <DefList>
            <DefItem label="Driver">
              {booking.assignedDriverId ? booking.assignedDriverId.slice(0, 8) : '—'}
            </DefItem>
            <DefItem label="Vehicle for this job">
              {booking.carForThisJob ? CAR_LABEL[booking.carForThisJob] : '—'}
            </DefItem>
          </DefList>
        </Card>
      ) : null}

      {booking.state === 'completed' ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Completed</CardTitle>
          </CardHeader>
          <DefList>
            <DefItem label="Car park">£{((booking.carParkPence ?? 0) / 100).toFixed(2)}</DefItem>
            <DefItem label="Waiting time">{booking.waitingTimeMinutes ?? 0} minutes</DefItem>
            <DefItem label="Drop-off">
              {booking.dropoffAt
                ? `${booking.dropoffAt.toISOString().replace('T', ' ').slice(0, 16)} UTC`
                : '—'}
            </DefItem>
          </DefList>
        </Card>
      ) : null}
    </PageContent>
  );
}

function DefList({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>;
}

function DefItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </>
  );
}
