import type { BookingState, VehicleClass } from '@/server/db/schema';

/**
 * Vehicle is free text. We display it as the operator typed it, with a few
 * convenience aliases for legacy enum-style values that may still sit in old
 * rows. New entries should already be human-readable.
 */
const LEGACY_CAR_ALIAS: Record<string, string> = {
  ex: 'Executive',
  s_class: 'Mercedes S-Class',
  mpv: 'MPV',
  mini_bus: 'Mini bus',
};

export function carLabel(value: string | null | undefined): string {
  if (!value) return '';
  const v = value.trim();
  return LEGACY_CAR_ALIAS[v] ?? v;
}

export const VEHICLE_CLASS_LABEL: Record<VehicleClass, string> = {
  executive: 'Executive',
  luxury: 'Luxury',
  mpv: 'MPV',
  coach: 'Coach',
};

/** "Black Mercedes S-Class" — colour + car, for SMS and identification. Falls
 * back gracefully when either part is missing. */
export function carDescription(
  car: string | null | undefined,
  colour: string | null | undefined,
): string {
  return [colour?.trim(), carLabel(car)].filter(Boolean).join(' ');
}

export const STATE_LABEL: Record<BookingState, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  in_progress: 'In progress',
  awaiting_driver_form: 'Awaiting driver form',
  awaiting_operator_review: 'Awaiting operator review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Tailwind classes for status lozenges, per state. */
export const STATE_BADGE: Record<BookingState, string> = {
  unassigned: 'bg-neutral-100 text-neutral-700',
  assigned: 'bg-brand-50 text-brand-700',
  in_progress: 'bg-info-100 text-info-700',
  awaiting_driver_form: 'bg-warning-50 text-warning-700',
  awaiting_operator_review: 'bg-warning-100 text-warning-700',
  completed: 'bg-success-50 text-success-700',
  cancelled: 'bg-neutral-100 text-neutral-600',
};

export const VEHICLE_CLASS_BADGE: Record<VehicleClass, string> = {
  executive: 'bg-brand-50 text-brand-700 border border-brand-100',
  luxury: 'bg-violet-50 text-violet-700 border border-violet-100',
  mpv: 'bg-info-100 text-info-700 border border-info-200',
  coach: 'bg-warning-50 text-warning-700 border border-warning-100',
};
