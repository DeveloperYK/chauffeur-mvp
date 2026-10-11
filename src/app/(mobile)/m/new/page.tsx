import { NewBookingScreen } from '@/components/mobile/new-booking-screen';
import { currentSession } from '@/server/auth/current';
import { sampleGeneratorEnabled } from '@/server/feature-flags';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MobileNewBooking() {
  const session = await currentSession();
  if (!session) redirect('/login');
  return (
    <NewBookingScreen
      meName={session.operator.name}
      showSampleGenerator={sampleGeneratorEnabled()}
    />
  );
}
