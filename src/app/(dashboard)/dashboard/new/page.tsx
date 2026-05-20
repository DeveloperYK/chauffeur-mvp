import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { PageContent, PageHeader } from '@/components/ui/page';
import Link from 'next/link';
import { newBookingAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
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

      {params.error ? (
        <Alert tone="danger" className="mb-4">
          {decodeURIComponent(params.error)}
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Booking details</CardTitle>
        </CardHeader>
        <form action={newBookingAction} className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Pickup date and time (UTC)" required className="md:col-span-2">
            <Input type="datetime-local" name="pickupAt" required />
          </Field>

          <Field label="Expected duration (minutes)" required helper="Between 15 and 720 minutes.">
            <Input
              type="number"
              name="expectedDurationMinutes"
              min={15}
              max={720}
              defaultValue={90}
              required
            />
          </Field>

          <Field label="Pickup address" required className="md:col-span-2">
            <Input type="text" name="pickupAddress" required maxLength={500} />
          </Field>

          <Field label="Drop-off address" required className="md:col-span-2">
            <Input type="text" name="dropoffAddress" required maxLength={500} />
          </Field>

          <Field label="Passenger first name" required>
            <Input type="text" name="passengerFirstName" required maxLength={80} />
          </Field>

          <Field label="Passenger last name" required>
            <Input type="text" name="passengerLastName" required maxLength={80} />
          </Field>

          <Field
            label="Executive mobile"
            required
            helper="International format with country code: e.g. +44 7911 123 456 or +1 (202) 555 0100."
            className="md:col-span-2"
          >
            <Input type="tel" name="execMobile" required placeholder="+44 7911 123 456" />
          </Field>

          <Field label="Account code" required helper="Customer account, e.g. LEGO or MERC.">
            <Input type="text" name="accountCode" required maxLength={40} />
          </Field>

          <Field label="Contract price (£)" required>
            <Input
              type="number"
              name="contractPricePounds"
              step="0.01"
              min={0}
              max={10000}
              required
              defaultValue="0"
            />
          </Field>

          <Field label="Notes" helper="Optional — special requests, flight number, etc.">
            <Input type="text" name="notes" maxLength={2000} />
          </Field>

          <div className="md:col-span-2 flex justify-end gap-2 border-t border-border pt-4">
            <Link href="/dashboard">
              <Button variant="ghost" type="button">
                Cancel
              </Button>
            </Link>
            <Button variant="primary" type="submit">
              Create booking
            </Button>
          </div>
        </form>
      </Card>
    </PageContent>
  );
}
