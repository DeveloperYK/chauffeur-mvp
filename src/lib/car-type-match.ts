/**
 * Requested car type vs. driver vehicle class.
 *
 * Bookings carry a free-text requested car type. The console offers JJ's six
 * vehicle types as quick-picks ({@link CAR_TYPES}); the PA may still ask for
 * something else, which is typed in as-is. Drivers are classified more
 * coarsely (executive / luxury / mpv / coach), so each type maps to the class
 * that serves it and we warn the operator when the assigned or candidate
 * driver's class differs. This only flags — it never blocks an assignment.
 */
import type { VehicleClass } from '@/server/db/schema';
import { VEHICLE_CLASS_LABEL } from './labels';

export type CarTypeMatch = 'match' | 'mismatch' | 'unknown';

export interface CarType {
  /** Stored on the booking, shown to the driver and mirrored to the sheet. */
  label: string;
  /** JJ's short code, accepted when typed by hand. */
  code: string;
  /** Driver class that serves this type; null when no class does (E Car). */
  vehicleClass: VehicleClass | null;
}

export const CAR_TYPES: readonly CarType[] = [
  { label: 'Executive', code: 'Ex', vehicleClass: 'executive' },
  { label: 'VIP – S Class', code: 'VIP', vehicleClass: 'luxury' },
  { label: 'MPV S – 7 Seater', code: 'MPV S', vehicleClass: 'mpv' },
  { label: 'MPV L – 8 Seater', code: 'MPV L', vehicleClass: 'mpv' },
  { label: 'E Car – Electric Only', code: 'E Car', vehicleClass: null },
  { label: 'Coach', code: 'C', vehicleClass: 'coach' },
];

/** Lower-case, dashes/en-dashes and runs of whitespace collapsed to one space. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

const CLASS_BY_TOKEN: ReadonlyMap<string, VehicleClass | null> = new Map([
  ...CAR_TYPES.flatMap((t) => [
    [normalise(t.label), t.vehicleClass] as const,
    [normalise(t.code), t.vehicleClass] as const,
  ]),
  // Legacy class names typed before the quick-picks existed.
  ...(Object.keys(VEHICLE_CLASS_LABEL) as VehicleClass[]).flatMap((cls) => [
    [cls, cls] as const,
    [normalise(VEHICLE_CLASS_LABEL[cls]), cls] as const,
  ]),
]);

/** The driver class a requested car type is served by, or null when unknown. */
export function requestedVehicleClass(requested: string | null | undefined): VehicleClass | null {
  if (!requested) return null;
  const token = normalise(requested);
  if (!token) return null;
  return CLASS_BY_TOKEN.get(token) ?? null;
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
  const wanted = requestedVehicleClass(requested);
  if (!wanted) return 'unknown';
  return wanted === driverClass ? 'match' : 'mismatch';
}

/** Operator-facing note for a mismatch, or null when there is nothing to flag. */
export function carTypeMismatchNote(
  requested: string | null | undefined,
  driverClass: VehicleClass,
): string | null {
  const wanted = requestedVehicleClass(requested);
  if (!wanted || wanted === driverClass || !requested) return null;
  return `Booking asks for ${requested.trim()} — this driver is ${VEHICLE_CLASS_LABEL[driverClass]}`;
}
