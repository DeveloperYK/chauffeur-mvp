'use server';

import { parseMonthString } from '@/lib/dates';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import {
  appUrl,
  db,
  driverLinkSecret,
  notifications,
  spreadsheetMirror,
} from '@/server/composition';
import { listBookingHistory } from '@/server/services/activity';
import { handToBackfill, updateBackfillPay } from '@/server/services/backfill';
import { type DayCounts, monthlyDayCounts } from '@/server/services/bookings-query';
import { cancelBooking } from '@/server/services/cancel';
import {
  approveBooking,
  completeFormOnBehalf,
  generateCompletionLink,
  rejectBooking,
} from '@/server/services/completion';
import { generateDispatchLinks, releaseDriver } from '@/server/services/dispatch';
import { editBooking } from '@/server/services/edit-booking';
import { assignOperator } from '@/server/services/operators';
import { revalidatePath } from 'next/cache';

// All console actions return a typed result so client overlays can react in
// place (toast + close + router.refresh) rather than navigating to a new page.

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export interface DispatchActionResult extends ActionResult {
  url?: string;
  whatsappUrl?: string;
  driverName?: string;
}

/** One minted link in a fan-out, serializable for the client modal. */
export interface DispatchOfferResult {
  driverId: string;
  driverName: string;
  url: string;
  whatsappUrl: string;
}

export interface DispatchManyActionResult extends ActionResult {
  offers?: DispatchOfferResult[];
  /** Drivers that couldn't be offered (inactive / not found). */
  skippedCount?: number;
}

export interface HistoryEntry {
  id: string;
  ts: string;
  actor: string;
  text: string;
}

async function requireOperator(): Promise<{ id: string } | null> {
  const session = await currentSession();
  return session ? { id: session.operator.id } : null;
}

// Driver messaging is WhatsApp-only — operators use the WhatsApp Web
// deep-link button on the dispatch/completion surfaces. There are no server-side
// driver SMS actions: the WhatsApp message is composed and sent by the
// operator from their device, so delivery is implicit (we don't need a
// Twilio call here and we don't have to surface a send error).

export async function generateCompletionLinkAction(
  bookingId: string,
): Promise<DispatchActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId) return { ok: false, error: 'Missing booking.' };

  const result = await generateCompletionLink(bookingId, op.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) return { ok: false, error: `Cannot generate link: ${result.reason}.` };
  revalidatePath('/dashboard');
  return { ok: true, url: result.url, whatsappUrl: result.whatsappUrl };
}

export async function completeFormOnBehalfAction(
  bookingId: string,
  input: {
    arrivalTime: string;
    passengerOnBoardTime: string;
    completionTime: string;
    carParkPence: number;
  },
): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId) return { ok: false, error: 'Missing booking.' };

  const result = await completeFormOnBehalf(
    bookingId,
    {
      arrivalTime: input.arrivalTime,
      passengerOnBoardTime: input.passengerOnBoardTime,
      completionTime: input.completionTime,
      carParkPence: input.carParkPence,
    },
    op.id,
    {
      db: db(),
      secret: driverLinkSecret(),
      appUrl: appUrl(),
      mirror: spreadsheetMirror(),
    },
  );
  if (!result.ok) {
    if (result.reason === 'validation') {
      const msg = result.issues
        .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
        .slice(0, 3)
        .join('; ');
      return { ok: false, error: msg };
    }
    const error =
      result.reason === 'times_invalid'
        ? 'Please check the times — they don’t add up.'
        : result.reason === 'booking_not_found'
          ? 'Booking not found.'
          : `Can only complete from awaiting-driver-form (it is ${result.state}).`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function dispatchManyAction(
  bookingId: string,
  driverIds: string[],
): Promise<DispatchManyActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId) return { ok: false, error: 'Missing booking.' };
  if (!Array.isArray(driverIds) || driverIds.length === 0) {
    return { ok: false, error: 'Select at least one driver.' };
  }

  const result = await generateDispatchLinks(bookingId, driverIds, op.id, {
    db: db(),
    notifications: notifications(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) {
    const error =
      result.reason === 'booking_not_found'
        ? 'Booking not found.'
        : result.reason === 'no_drivers'
          ? 'Select at least one driver.'
          : `Cannot dispatch from state: ${result.state}.`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return {
    ok: true,
    offers: result.offers.map((o) => ({
      driverId: o.driver.id,
      driverName: o.driver.name,
      url: o.url,
      whatsappUrl: o.whatsappUrl,
    })),
    skippedCount: result.skipped.length,
  };
}

export async function approveBookingAction(bookingId: string): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  const result = await approveBooking(bookingId, op.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) return { ok: false, error: `Cannot approve: ${result.reason}.` };
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function rejectBookingAction(bookingId: string): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  const result = await rejectBooking(bookingId, op.id, {
    db: db(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) return { ok: false, error: `Cannot reject: ${result.reason}.` };
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function releaseDriverAction(bookingId: string): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  const result = await releaseDriver(bookingId, op.id, {
    db: db(),
    notifications: notifications(),
    secret: driverLinkSecret(),
    appUrl: appUrl(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) {
    const error =
      result.reason === 'booking_not_found'
        ? 'Booking not found.'
        : 'This booking no longer has a driver to release.';
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function handToBackfillAction(
  bookingId: string,
  input: { name: string; phone: string; car: string; payPence: number },
): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId) return { ok: false, error: 'Missing booking.' };

  const result = await handToBackfill(bookingId, input, op.id, {
    db: db(),
    notifications: notifications(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) {
    if (result.reason === 'validation') {
      const msg = result.issues
        .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
        .slice(0, 3)
        .join('; ');
      return { ok: false, error: msg };
    }
    const error =
      result.reason === 'booking_not_found'
        ? 'Booking not found.'
        : `Can only hand a booking to backfill from unassigned (it is ${result.state}).`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function updateBackfillPayAction(
  bookingId: string,
  payPence: number,
): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId) return { ok: false, error: 'Missing booking.' };

  const result = await updateBackfillPay(bookingId, payPence, op.id, {
    db: db(),
    notifications: notifications(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) {
    const error =
      result.reason === 'validation'
        ? 'Enter a valid driver pay (between £0.01 and £10,000).'
        : result.reason === 'booking_not_found'
          ? 'Booking not found.'
          : 'This booking is not a backfill job.';
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function cancelBookingAction(
  bookingId: string,
  reason: string,
): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  const result = await cancelBooking({ bookingId, reason }, op.id, {
    db: db(),
    mirror: spreadsheetMirror(),
  });
  if (!result.ok) {
    const error =
      result.reason === 'validation'
        ? 'Please give a reason (at least 5 characters).'
        : result.reason === 'booking_not_found'
          ? 'Booking not found.'
          : `Cannot cancel from state: ${result.state}.`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function assignBookingOperatorAction(
  bookingId: string,
  operatorId: string | null,
): Promise<ActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  await assignOperator(bookingId, operatorId, op.id, {
    db: db(),
    mirror: spreadsheetMirror(),
  });
  revalidatePath('/dashboard');
  return { ok: true };
}

export interface EditBookingActionResult extends ActionResult {
  changedFields?: string[];
}

export async function editBookingAction(formData: FormData): Promise<EditBookingActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };

  const poundsRaw = formData.get('contractPricePounds');
  const pounds = poundsRaw == null ? 0 : Number.parseFloat(String(poundsRaw));
  const pence = Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;

  const distanceRaw = formData.get('distanceMeters');
  const distanceMeters =
    distanceRaw == null || String(distanceRaw) === ''
      ? null
      : Number.parseInt(String(distanceRaw), 10);

  const raw = {
    bookingId: String(formData.get('bookingId') ?? ''),
    serviceType: String(formData.get('serviceType') ?? 'transfer'),
    pickupAt: String(formData.get('pickupAt') ?? ''),
    expectedDurationMinutes: String(formData.get('expectedDurationMinutes') ?? ''),
    distanceMeters,
    pickupAddress: String(formData.get('pickupAddress') ?? ''),
    dropoffAddress: String(formData.get('dropoffAddress') ?? ''),
    passengerFirstName: String(formData.get('passengerFirstName') ?? ''),
    passengerLastName: String(formData.get('passengerLastName') ?? '') || null,
    execMobile: String(formData.get('execMobile') ?? ''),
    customerAccount: String(formData.get('customerAccount') ?? ''),
    caseCode: String(formData.get('caseCode') ?? ''),
    contractPricePence: pence,
    notes: (formData.get('notes') as string | null) || null,
    operatorNotes: (formData.get('operatorNotes') as string | null) || null,
  };

  const result = await editBooking(raw, op.id, { db: db(), mirror: spreadsheetMirror() });
  if (!result.ok) {
    if (result.reason === 'validation') {
      const msg = result.issues
        .map((i) => `${i.path.join('.') || 'field'}: ${i.message}`)
        .slice(0, 3)
        .join('; ');
      return { ok: false, error: msg };
    }
    const error =
      result.reason === 'booking_not_found'
        ? 'Booking not found.'
        : `Cannot edit a ${result.state} booking.`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return { ok: true, changedFields: result.changedFields };
}

export async function bookingHistoryAction(bookingId: string): Promise<HistoryEntry[]> {
  const op = await requireOperator();
  if (!op) return [];
  try {
    const trail = await listBookingHistory(db(), bookingId);
    return trail.map((e) => ({ id: e.id, ts: e.ts.toISOString(), actor: e.actor, text: e.text }));
  } catch (error) {
    logger.error({ err: error }, 'Failed to load booking history');
    return [];
  }
}

/**
 * Per-day booking counts for a calendar month (YYYY-MM), so the calendar popover
 * can render its day badges for a month the operator pages to without a full
 * server navigation. Returns an empty map for an unauthenticated request or a
 * malformed month.
 */
export async function dayCountsAction(month: string): Promise<Record<string, DayCounts>> {
  const op = await requireOperator();
  if (!op) return {};
  if (!parseMonthString(month)) return {};
  const map = await monthlyDayCounts(db(), month);
  const out: Record<string, DayCounts> = {};
  for (const [day, c] of map.entries()) out[day] = c;
  return out;
}
