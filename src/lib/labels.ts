import type { BookingState, CarType, DriverTier } from '@/server/db/schema';

export const CAR_LABEL: Record<CarType, string> = {
  ex: 'Executive',
  s_class: 'S-Class',
  mpv: 'MPV',
  mini_bus: 'Mini bus',
};

export const TIER_LABEL: Record<DriverTier, string> = {
  premium: 'Premium',
  ordinary: 'Ordinary',
};

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

export const TIER_BADGE: Record<DriverTier, string> = {
  premium: 'bg-brand-50 text-brand-700 border border-brand-100',
  ordinary: 'bg-neutral-100 text-neutral-700 border border-neutral-200',
};
