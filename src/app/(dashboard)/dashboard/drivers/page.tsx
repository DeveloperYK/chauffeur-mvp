import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageContent, PageHeader } from '@/components/ui/page';
import { env } from '@/lib/env';
import { TIER_BADGE, TIER_LABEL, carLabel } from '@/lib/labels';
import { getDb } from '@/server/db';
import { listAllDrivers } from '@/server/services/drivers';
import Link from 'next/link';
import { deactivateDriverAction, reactivateDriverAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function DriversPage() {
  const url = env().DATABASE_URL;
  if (!url) {
    return (
      <PageContent>
        <p className="text-danger-700">DATABASE_URL not configured.</p>
      </PageContent>
    );
  }
  const { db } = getDb(url);
  const drivers = await listAllDrivers(db);
  const activeCount = drivers.filter((d) => d.active).length;

  return (
    <PageContent>
      <PageHeader
        title="Drivers"
        description={`${activeCount} active · ${drivers.length} total`}
        actions={
          <Link href="/dashboard/drivers/new">
            <Button variant="primary">+ Add driver</Button>
          </Link>
        }
      />

      <Card padded={false}>
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-border bg-surface-sunken">
            <tr>
              <Th>Name</Th>
              <Th>Tier</Th>
              <Th>Default vehicle</Th>
              <Th>WhatsApp</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {drivers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink-muted">
                  No drivers yet. Add one to get started.
                </td>
              </tr>
            ) : (
              drivers.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <Td>
                    <span className="font-medium text-ink">{d.name}</span>
                  </Td>
                  <Td>
                    <Badge className={TIER_BADGE[d.tier]}>{TIER_LABEL[d.tier]}</Badge>
                  </Td>
                  <Td>{carLabel(d.defaultCarType)}</Td>
                  <Td>
                    <code className="font-mono text-xs text-ink-subtle">{d.whatsappNumber}</code>
                  </Td>
                  <Td>
                    {d.active ? (
                      <Badge className="bg-success-50 text-success-700">Active</Badge>
                    ) : (
                      <Badge className="bg-neutral-100 text-ink-muted">Inactive</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Link href={`/dashboard/drivers/${d.id}/edit`}>
                        <Button variant="ghost" size="sm">
                          Edit
                        </Button>
                      </Link>
                      {d.active ? (
                        <form action={deactivateDriverAction} className="inline">
                          <input type="hidden" name="id" value={d.id} />
                          <Button variant="ghost" size="sm" type="submit">
                            Deactivate
                          </Button>
                        </form>
                      ) : (
                        <form action={reactivateDriverAction} className="inline">
                          <input type="hidden" name="id" value={d.id} />
                          <Button variant="ghost" size="sm" type="submit">
                            Reactivate
                          </Button>
                        </form>
                      )}
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </PageContent>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle ${className ?? ''}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-sm align-middle ${className ?? ''}`}>{children}</td>;
}
