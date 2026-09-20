/**
 * Requested car type vs. driver vehicle class.
 *
 * The booking's requested car type is free text (the PA may ask for "MPV",
 * "Luxury", or "Range Rover"). When it names one of our vehicle classes we can
 * compare it with the assigned/candidate driver's class and warn the operator
 * on a mismatch. This only flags — it never blocks an assignment.
 */
import type { VehicleClass } from '@/server/db/schema';
import { VEHICLE_CLASS_LABEL } from './labels';

export type CarTypeMatch = 'match' | 'mismatch' | 'unknown';

const CLASS_BY_TOKEN: ReadonlyMap<string, VehicleClass> = new Map(
  (Object.keys(VEHICLE_CLASS_LABEL) as VehicleClass[]).flatMap((cls) => [
    [cls, cls] as const,
    [VEHICLE_CLASS_LABEL[cls].toLowerCase(), cls] as const,
  ]),
);

/** The vehicle class a requested car type names, or null for other free text. */
export function requestedVehicleClass(requested: string | null | undefined): VehicleClass | null {
  const token = requested?.trim().toLowerCase();
  if (!token) return null;
  return CLASS_BY_TOKEN.get(token) ?? null;
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
  if (!wanted || wanted === driverClass) return null;
  return `Booking asks for ${VEHICLE_CLASS_LABEL[wanted]} — this driver is ${VEHICLE_CLASS_LABEL[driverClass]}`;
}
