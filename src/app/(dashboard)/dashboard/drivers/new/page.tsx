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
    <div style={{ maxWidth: 600 }}>
      <Link href="/dashboard/drivers" style={{ color: '#2563eb' }}>
        ← Back to roster
      </Link>
      <h1>Add driver</h1>
      <DriverForm action={newDriverAction} error={params.error} />
    </div>
  );
}
