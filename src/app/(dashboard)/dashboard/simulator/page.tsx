import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { PageContent, PageHeader } from '@/components/ui/page';
import { STATE_BADGE, STATE_LABEL } from '@/lib/labels';
import { db, fakeMirror, fakeNotifier } from '@/server/composition';
import type { BookingState } from '@/server/db/schema';
import { listAllForSimulator } from '@/server/services/simulator';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  clockTickAction,
  fastForwardAction,
  forceStateAction,
  resetAction,
  seedAction,
} from './actions';

export const dynamic = 'force-dynamic';

const STATES: BookingState[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
  'completed',
  'cancelled',
];

const SUCCESS: Record<string, string> = {
  seeded: 'Sample data seeded.',
  reset: 'All data wiped (operators kept).',
  ticked: 'Clock tick executed.',
  'fast-forwarded': 'Booking time shifted.',
  forced: 'Ticket forced into state.',
};

export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();

  const search = await searchParams;
  const bookings = await listAllForSimulator(db());
  const sentSms = fakeNotifier.sent.slice(-10).reverse();
  const mirrorRows = Array.from(fakeMirror.rows.values()).slice(-10);

  return (
    <PageContent>
      <PageHeader
        title="Simulator"
        description="Dev-only sandbox: seed data, advance time, force state transitions, and inspect the in-memory SMS + Sheets mirrors."
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Board
          </Link>
        }
      />

      {search.ok ? (
        <Alert tone="success" className="mb-4">
          {SUCCESS[search.ok] ?? 'Done.'}
        </Alert>
      ) : null}
      {search.error ? (
        <Alert tone="danger" className="mb-4">
          {decodeURIComponent(search.error)}
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <p className="mb-3 text-sm text-ink-muted">
            Seed creates 5 drivers (premium + ordinary) and 3 sample bookings with realistic timing.
            Reset wipes everything except operator accounts and clears the in-memory SMS and Sheets
            mirrors.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={seedAction}>
              <Button variant="primary" type="submit">
                Seed sample data
              </Button>
            </form>
            <form action={resetAction}>
              <Button variant="danger" type="submit">
                Reset all data
              </Button>
            </form>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clock</CardTitle>
          </CardHeader>
          <p className="mb-3 text-sm text-ink-muted">
            Run one pass of the clock service. In production this is triggered every minute by an
            external scheduler — here you fire it on demand.
          </p>
          <form action={clockTickAction}>
            <Button variant="primary" type="submit">
              Run clock tick
            </Button>
          </form>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Bookings ({bookings.length})</CardTitle>
        </CardHeader>
        {bookings.length === 0 ? (
          <p className="text-sm italic text-ink-muted">
            No bookings yet. Seed sample data or create one on the board.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-border bg-surface-sunken">
                <tr>
                  <Th>Passenger</Th>
                  <Th>State</Th>
                  <Th>Pickup</Th>
                  <Th>Account</Th>
                  <Th>Fast-forward</Th>
                  <Th>Force state</Th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <Td>
                      <Link
                        href={`/dashboard/bookings/${b.id}`}
                        className="text-brand-700 hover:underline"
                      >
                        {b.passengerName}
                      </Link>
                    </Td>
                    <Td>
                      <Badge size="sm" className={STATE_BADGE[b.state]}>
                        {STATE_LABEL[b.state]}
                      </Badge>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">
                        {b.pickupAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
                      </span>
                    </Td>
                    <Td>{b.accountCode}</Td>
                    <Td>
                      <form action={fastForwardAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="bookingId" value={b.id} />
                        <Select
                          name="scenario"
                          defaultValue="about_to_start"
                          className="w-44 text-xs"
                        >
                          <option value="about_to_start">Pickup in 30 min</option>
                          <option value="trip_finished">Trip just ended</option>
                          <option value="aged_unaccepted">Created 25h ago</option>
                        </Select>
                        <Button size="sm" type="submit">
                          Apply
                        </Button>
                      </form>
                    </Td>
                    <Td>
                      <form action={forceStateAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="bookingId" value={b.id} />
                        <Select name="state" defaultValue={b.state} className="w-44 text-xs">
                          {STATES.map((s) => (
                            <option key={s} value={s}>
                              {STATE_LABEL[s]}
                            </option>
                          ))}
                        </Select>
                        <Button size="sm" type="submit">
                          Set
                        </Button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>SMS sent ({fakeNotifier.sent.length} total, showing latest 10)</CardTitle>
          </CardHeader>
          {sentSms.length === 0 ? (
            <p className="text-sm italic text-ink-muted">No SMS yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sentSms.map((m, i) => (
                <li
                  key={`${m.to}-${i}`}
                  className="rounded border border-border bg-surface-sunken p-2"
                >
                  <p className="font-mono text-xs text-ink-muted">{m.to}</p>
                  <p className="text-sm text-ink">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sheets mirror ({fakeMirror.rows.size} rows)</CardTitle>
          </CardHeader>
          {mirrorRows.length === 0 ? (
            <p className="text-sm italic text-ink-muted">No rows mirrored yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-xs">
              {mirrorRows.map((row) => (
                <li
                  key={`${row[0]}-${row[1]}`}
                  className="rounded border border-border bg-surface-sunken p-2 font-mono"
                >
                  <p>
                    <span className="text-ink-muted">Job</span> {row[0]} ·{' '}
                    <span className="text-ink-muted">Driver</span> {row[12] || '—'} ·{' '}
                    <span className="text-ink-muted">Car</span> {row[10] || '—'} ·{' '}
                    <span className="text-ink-muted">Price £</span>
                    {row[11]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </PageContent>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-middle">{children}</td>;
}
