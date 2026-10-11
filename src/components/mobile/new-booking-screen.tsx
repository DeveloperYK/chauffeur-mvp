'use client';
import { NewBookingModal } from '@/components/console/new-booking-modal';
import { useRouter } from 'next/navigation';

interface NewBookingScreenProps {
  meName: string;
  showSampleGenerator: boolean;
}

/**
 * The create form is the board's modal, rendered open and styled as a
 * full-screen sheet by the shell. Closing returns to the day list; creating
 * lands on the booking's day with a confirmation toast.
 */
export function NewBookingScreen({ meName, showSampleGenerator }: NewBookingScreenProps) {
  const router = useRouter();
  return (
    <NewBookingModal
      isOpen
      meName={meName}
      onClose={() => router.push('/m')}
      onCreated={(day) => router.push(day ? `/m?date=${day}&created=1` : '/m?created=1')}
      showSampleGenerator={showSampleGenerator}
    />
  );
}
