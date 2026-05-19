import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { PageContent, PageHeader } from '@/components/ui/page';
import Link from 'next/link';
import { DriverForm } from '../driver-form';
import { newDriverAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NewDriverPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <PageContent className="max-w-2xl">
      <PageHeader
        title="Add driver"
        breadcrumb={
          <Link href="/dashboard/drivers" className="hover:underline">
            Drivers
          </Link>
        }
      />
      {params.error ? (
        <Alert tone="danger" className="mb-4">
          {decodeURIComponent(params.error)}
        </Alert>
      ) : null}
      <Card>
        <DriverForm action={newDriverAction} />
      </Card>
    </PageContent>
  );
}
