import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { PageContent, PageHeader } from '@/components/ui/page';
import { env } from '@/lib/env';
import { getDb } from '@/server/db';
import { getDriver } from '@/server/services/drivers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DriverForm } from '../../driver-form';
import { editDriverAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function EditDriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
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
  const driver = await getDriver(db, id);
  if (!driver) notFound();

  return (
    <PageContent className="max-w-2xl">
      <PageHeader
        title={`Edit ${driver.name}`}
        breadcrumb={
          <Link href="/dashboard/drivers" className="hover:underline">
            Drivers
          </Link>
        }
      />
      {search.error ? (
        <Alert tone="danger" className="mb-4">
          {decodeURIComponent(search.error)}
        </Alert>
      ) : null}
      <Card>
        <DriverForm action={editDriverAction} driver={driver} />
      </Card>
    </PageContent>
  );
}
