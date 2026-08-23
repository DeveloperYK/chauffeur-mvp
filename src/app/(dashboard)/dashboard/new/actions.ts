'use server';
import { formatLondonDay, parseMonthString } from '@/lib/dates';
import { env } from '@/lib/env';
import { fieldErrorsFromIssues } from '@/lib/form-errors';
import { logger } from '@/lib/logger';
import { currentSession } from '@/server/auth/current';
import { spreadsheetMirror } from '@/server/composition';
import { getDb } from '@/server/db';
import { createBooking } from '@/server/services/bookings';
import {
  type AccountSuggestion,
  listAccountCodeSuggestions,
} from '@/server/services/bookings-query';
import { redirect } from 'next/navigation';

export interface CreateBookingActionResult {
  /** Form-level summary, shown as a banner (e.g. "Please fix the highlighted fields"). */
  error?: string;
  /** Per-field messages keyed by field name, rendered inline under each control. */
  fieldErrors?: Record<string, string>;
  success?: boolean;
  /** London day (YYYY-MM-DD) of the new booking's pickup, so the board can jump to it. */
  bookingDay?: string;
}

export async function createBookingAction(formData: FormData): Promise<CreateBookingActionResult> {
  const session = await currentSession();
  if (!session) {
    return { error: 'Not authenticated' };
  }

  const url = env().DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL not set');
    return { error: 'Server not configured' };
  }

  const poundsRaw = formData.get('contractPricePounds');
  const pounds = poundsRaw == null ? 0 : Number.parseFloat(String(poundsRaw));
  const pence = Number.isFinite(pounds) ? Math.round(pounds * 100) : 0;

  const assignedDriverId = formData.get('assignedDriverId');
  const markAsAccepted = formData.get('markAsAccepted') === 'true';

  const distanceRaw = formData.get('distanceMeters');
  const distanceMeters =
    distanceRaw == null || String(distanceRaw) === ''
      ? null
      : Number.parseInt(String(distanceRaw), 10);

  const raw = {
    serviceType: String(formData.get('serviceType') ?? 'transfer'),
    pickupAt: String(formData.get('pickupAt') ?? ''),
    expectedDurationMinutes: String(formData.get('expectedDurationMinutes') ?? ''),
    distanceMeters,
    pickupAddress: String(formData.get('pickupAddress') ?? ''),
    dropoffAddress: String(formData.get('dropoffAddress') ?? ''),
    passengerFirstName: String(formData.get('passengerFirstName') ?? ''),
    passengerLastName: String(formData.get('passengerLastName') ?? '') || null,
    execMobile: String(formData.get('execMobile') ?? ''),
    execEmail: String(formData.get('execEmail') ?? '') || null,
    customerAccount: String(formData.get('customerAccount') ?? ''),
    caseCode: String(formData.get('caseCode') ?? ''),
    contractPricePence: pence,
    travelMode: String(formData.get('travelMode') ?? '') || null,
    travelRef: String(formData.get('travelRef') ?? '') || null,
    notes: (formData.get('notes') as string | null) ?? null,
    operatorNotes: (formData.get('operatorNotes') as string | null) ?? null,
    assignedDriverId: assignedDriverId ? String(assignedDriverId) : null,
    markAsAccepted,
  };

  const { db } = getDb(url);
  const result = await createBooking(raw, {
    db,
    operatorId: session.operator.id,
    mirror: spreadsheetMirror(),
  });

  if (!result.ok) {
    if (result.reason === 'pickup_in_past') {
      const message = 'Pickup must be in the future.';
      return { error: message, fieldErrors: { pickupAt: message } };
    }
    if (result.reason === 'driver_not_found') {
      return { error: 'Selected driver not found.' };
    }
    if (result.reason === 'driver_inactive') {
      return { error: 'Selected driver is inactive.' };
    }
    return {
      error: 'Please fix the highlighted fields.',
      fieldErrors: fieldErrorsFromIssues(result.issues),
    };
  }

  return { success: true, bookingDay: formatLondonDay(result.booking.pickupAt) };
}

/**
 * Distinct customer-account strings to autocomplete the account field, scoped
 * to the booking's pickup month plus recent history. Keeps invoicing consistent
 * by nudging operators to reuse an existing spelling. Returns `[]` (never throws)
 * so a typeahead lookup can never block creating a booking.
 */
export async function accountSuggestionsAction(month: string): Promise<AccountSuggestion[]> {
  const session = await currentSession();
  if (!session) return [];
  if (!parseMonthString(month)) return [];
  const url = env().DATABASE_URL;
  if (!url) return [];
  const { db } = getDb(url);
  return listAccountCodeSuggestions(db, month);
}

// Legacy action for backwards compatibility
export async function newBookingAction(formData: FormData): Promise<void> {
  const result = await createBookingAction(formData);
  if (result.error) {
    redirect(`/dashboard/new?error=${encodeURIComponent(result.error)}`);
  }
  redirect('/dashboard');
}
