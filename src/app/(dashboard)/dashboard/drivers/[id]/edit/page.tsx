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
  if (!url) return <p style={{ color: '#b91c1c' }}>DATABASE_URL not configured.</p>;
  const { db } = getDb(url);
  const driver = await getDriver(db, id);
  if (!driver) notFound();
  return (
    <div style={{ maxWidth: 600 }}>
      <Link href="/dashboard/drivers" style={{ color: '#2563eb' }}>
        ← Back to roster
      </Link>
      <h1>Edit driver</h1>
      <DriverForm action={editDriverAction} driver={driver} error={search.error} />
    </div>
  );
}
