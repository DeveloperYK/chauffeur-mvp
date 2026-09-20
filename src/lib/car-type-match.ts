/**
 * Requested car type vs. driver vehicle class.
 *
 * Bookings carry a free-text requested car type. The console offers JJ's six
 * vehicle types as quick-picks ({@link CAR_TYPES}) — the very same list the
 * driver roster classifies drivers by — so a booking's ask and a driver's class
 * line up 1:1 and the console can warn the operator when the assigned or
 * candidate driver's class differs. The PA may still ask for something else,
 * which is typed in as-is and never warns. This only flags — it never blocks.
 */
import type { VehicleClass } from '@/server/db/schema';
import { VEHICLE_CLASSES, VEHICLE_CLASS_LABEL } from './labels';

export type CarTypeMatch = 'match' | 'mismatch' | 'unknown';

export interface CarType {
  /** Stored on the booking, shown to the driver and mirrored to the sheet. */
  label: string;
  /** JJ's short code, accepted when typed by hand. */
  code: string;
  vehicleClass: VehicleClass;
}

const CODE: Record<VehicleClass, string> = {
  executive: 'Ex',
  vip: 'VIP',
  mpv_s: 'MPV S',
  mpv_l: 'MPV L',
  e_car: 'E Car',
  coach: 'C',
};

export const CAR_TYPES: readonly CarType[] = VEHICLE_CLASSES.map((vehicleClass) => ({
  label: VEHICLE_CLASS_LABEL[vehicleClass],
  code: CODE[vehicleClass],
  vehicleClass,
}));

/** Lower-case, dashes/en-dashes and runs of whitespace collapsed to one space. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Class names from before the six-type roster, still on older bookings. */
const LEGACY: ReadonlyMap<string, readonly VehicleClass[]> = new Map([
  ['luxury', ['vip']],
  // A plain "MPV" never said which size, so either MPV driver satisfies it.
  ['mpv', ['mpv_s', 'mpv_l']],
]);

const CLASSES_BY_TOKEN: ReadonlyMap<string, readonly VehicleClass[]> = new Map([
  ...CAR_TYPES.flatMap((t) => [
    [normalise(t.label), [t.vehicleClass]] as const,
    [normalise(t.code), [t.vehicleClass]] as const,
    [t.vehicleClass.replace('_', ' '), [t.vehicleClass]] as const,
  ]),
  ...LEGACY,
]);

/** Driver classes that satisfy a requested car type; empty when unknown. */
export function requestedVehicleClasses(
  requested: string | null | undefined,
): readonly VehicleClass[] {
  if (!requested) return [];
  const token = normalise(requested);
  if (!token) return [];
  return CLASSES_BY_TOKEN.get(token) ?? [];
}

/** The picker entry a stored value corresponds to, if any. */
export function carTypeFor(requested: string | null | undefined): CarType | null {
  if (!requested) return null;
  const token = normalise(requested);
  return CAR_TYPES.find((t) => normalise(t.label) === token || normalise(t.code) === token) ?? null;
}

export function carTypeMatch(
  requested: string | null | undefined,
  driverClass: VehicleClass,
): CarTypeMatch {
  const wanted = requestedVehicleClasses(requested);
  if (wanted.length === 0) return 'unknown';
  return wanted.includes(driverClass) ? 'match' : 'mismatch';
}

/** Operator-facing note for a mismatch, or null when there is nothing to flag. */
export function carTypeMismatchNote(
  requested: string | null | undefined,
  driverClass: VehicleClass,
): string | null {
  if (!requested || carTypeMatch(requested, driverClass) !== 'mismatch') return null;
  return `Booking asks for ${requested.trim()} — this driver is ${VEHICLE_CLASS_LABEL[driverClass]}`;
}
