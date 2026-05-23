'use server';

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
import { cancelBooking } from '@/server/services/cancel';
import {
  approveBooking,
  generateCompletionLink,
  rejectBooking,
} from '@/server/services/completion';
import { generateDispatchLink } from '@/server/services/dispatch';
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

export async function dispatchAction(
  bookingId: string,
  driverId: string,
): Promise<DispatchActionResult> {
  const op = await requireOperator();
  if (!op) return { ok: false, error: 'Not authenticated.' };
  if (!bookingId || !driverId) return { ok: false, error: 'Missing booking or driver.' };

  const result = await generateDispatchLink(bookingId, driverId, op.id, {
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
        : result.reason === 'driver_not_found'
          ? 'Driver not found.'
          : result.reason === 'driver_inactive'
            ? 'Driver is inactive.'
            : `Cannot dispatch from state: ${result.state}.`;
    return { ok: false, error };
  }
  revalidatePath('/dashboard');
  return {
    ok: true,
    url: result.url,
    whatsappUrl: result.whatsappUrl,
    driverName: result.driver.name,
  };
}

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

  const raw = {
    bookingId: String(formData.get('bookingId') ?? ''),
    pickupAt: String(formData.get('pickupAt') ?? ''),
    expectedDurationMinutes: String(formData.get('expectedDurationMinutes') ?? ''),
    pickupAddress: String(formData.get('pickupAddress') ?? ''),
    dropoffAddress: String(formData.get('dropoffAddress') ?? ''),
    passengerFirstName: String(formData.get('passengerFirstName') ?? ''),
    passengerLastName: String(formData.get('passengerLastName') ?? '') || null,
    execMobile: String(formData.get('execMobile') ?? ''),
    clientName: String(formData.get('clientName') ?? ''),
    accountCode: String(formData.get('accountCode') ?? ''),
    contractPricePence: pence,
    notes: (formData.get('notes') as string | null) || null,
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
