import type { Booking, Driver } from '@/server/db/schema';

function timeLine(d: Date): string {
  return `${d.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

function displayCar(value: string): string {
  // Legacy enum-style fallback so old rows still read nicely.
  switch (value) {
    case 'ex':
      return 'Executive';
    case 's_class':
      return 'Mercedes S-Class';
    case 'mpv':
      return 'MPV';
    case 'mini_bus':
      return 'Mini bus';
    default:
      return value;
  }
}

export function assignedSms(booking: Booking, driver: Driver, carForJob: string): string {
  return `Your chauffeur for ${timeLine(booking.pickupAt)} is confirmed. Driver: ${driver.name}. Car: ${displayCar(carForJob)}. Pickup: ${booking.pickupAddress}`;
}

export function enRouteSms(booking: Booking, driver: Driver): string {
  return `Your driver ${driver.name} is en route for pickup at ${timeLine(booking.pickupAt)}.`;
}
