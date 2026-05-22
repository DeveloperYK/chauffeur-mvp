import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { PageContent, PageHeader } from '@/components/ui/page';
import { env } from '@/lib/env';
import { currentSession } from '@/server/auth/current';
import { getDb } from '@/server/db';
import { listActiveDrivers } from '@/server/services/drivers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BookingForm } from './booking-form';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect('/login');

  const params = await searchParams;
  const url = env().DATABASE_URL;

  let drivers: Array<{
    id: string;
    name: string;
    tier: 'premium' | 'ordinary';
    defaultCarType: string;
  }> = [];

  if (url) {
    const { db } = getDb(url);
    const driverList = await listActiveDrivers(db);
    drivers = driverList.map((d) => ({
      id: d.id,
      name: d.name,
      tier: d.tier,
      defaultCarType: d.defaultCarType,
    }));
  }

  return (
    <PageContent className="max-w-3xl">
      <PageHeader
        title="New booking"
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Board
          </Link>
        }
        description="Capture the booking exactly as the secretary describes it on the call."
      />

      <Card>
        <CardHeader>
          <CardTitle>Booking details</CardTitle>
        </CardHeader>
        <BookingForm
          drivers={drivers}
          error={params.error ? decodeURIComponent(params.error) : undefined}
        />
      </Card>
    </PageContent>
  );
}
