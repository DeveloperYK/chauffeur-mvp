import type { Booking, CarType, Driver } from '@/server/db/schema';

const CAR_LABEL: Record<CarType, string> = {
  ex: 'EX',
  s_class: 'S Class',
  mpv: 'MPV',
  mini_bus: 'Mini Bus',
};

function timeLine(d: Date): string {
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

export function assignedSms(booking: Booking, driver: Driver, carForJob: CarType): string {
  return `Your chauffeur for ${timeLine(booking.pickupAt)} is confirmed. Driver: ${driver.name}. Car: ${CAR_LABEL[carForJob]}. Pickup: ${booking.pickupAddress}`;
}

export function enRouteSms(booking: Booking, driver: Driver): string {
  return `Your driver ${driver.name} is en route for pickup at ${timeLine(booking.pickupAt)}.`;
}
