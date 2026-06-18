import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { FakeEmailAdapter } from '@/server/adapters/email-fake';
import { ResendEmailAdapter } from '@/server/adapters/email-resend';
import { FakeNotificationAdapter } from '@/server/adapters/notification-fake';
import { TwilioNotificationAdapter } from '@/server/adapters/notification-twilio';
import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { GoogleSheetsSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-google';
import { getDb } from '@/server/db';
import type { EmailPort } from '@/server/ports/email';
import type { NotificationPort } from '@/server/ports/notifications';
import type { SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';

const fakeNotifier = new FakeNotificationAdapter();
let twilioNotifier: TwilioNotificationAdapter | undefined;
const fakeEmailer = new FakeEmailAdapter();
let resendEmailer: ResendEmailAdapter | undefined;
const fakeMirror = new FakeSpreadsheetMirror();
let googleMirror: GoogleSheetsSpreadsheetMirror | undefined;

/** Single composition root. */
export function notifications(): NotificationPort {
  const e = env();
  if (e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_FROM_NUMBER) {
    if (!twilioNotifier) {
      twilioNotifier = new TwilioNotificationAdapter({
        accountSid: e.TWILIO_ACCOUNT_SID,
        authToken: e.TWILIO_AUTH_TOKEN,
        fromNumber: e.TWILIO_FROM_NUMBER,
      });
      logger.info('using TwilioNotificationAdapter');
    }
    return twilioNotifier;
  }
  return fakeNotifier;
}

export function email(): EmailPort {
  const e = env();
  if (e.RESEND_API_KEY && e.RESEND_FROM) {
    if (!resendEmailer) {
      resendEmailer = new ResendEmailAdapter({ apiKey: e.RESEND_API_KEY, from: e.RESEND_FROM });
      logger.info('using ResendEmailAdapter');
    }
    return resendEmailer;
  }
  return fakeEmailer;
}

export function spreadsheetMirror(): SpreadsheetMirrorPort {
  const e = env();
  if (e.GOOGLE_SHEETS_SPREADSHEET_ID && e.GOOGLE_SERVICE_ACCOUNT_JSON) {
    if (!googleMirror) {
      googleMirror = new GoogleSheetsSpreadsheetMirror({
        spreadsheetId: e.GOOGLE_SHEETS_SPREADSHEET_ID,
        serviceAccountJson: e.GOOGLE_SERVICE_ACCOUNT_JSON,
      });
      logger.info('using GoogleSheetsSpreadsheetMirror');
    }
    return googleMirror;
  }
  return fakeMirror;
}

export function appUrl(): string {
  return env().APP_URL;
}

export function driverLinkSecret(): string {
  const s = env().DRIVER_LINK_SECRET;
  if (!s) {
    throw new Error('DRIVER_LINK_SECRET must be set');
  }
  return s;
}

export function db() {
  const url = env().DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL must be set');
  return getDb(url).db;
}

// Re-export for tests that need the in-memory fakes.
export { fakeNotifier, fakeEmailer, fakeMirror };
