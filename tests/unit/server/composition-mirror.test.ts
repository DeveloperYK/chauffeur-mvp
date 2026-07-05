import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// composition caches the mirror at module scope and env() caches process.env, so
// each scenario gets a fresh module graph via vi.resetModules() + dynamic import.
// process.env is snapshotted and restored so we never leak into other files.
const ORIGINAL_ENV = process.env;

// Minimal service-account JSON: the Google adapter's constructor only checks that
// client_email and private_key are present and the string is valid JSON.
const FAKE_SA = JSON.stringify({
  client_email: 'mirror@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
});

/** Replace process.env wholesale so NODE_ENV (a readonly prop) can be set safely. */
function setEnv(overrides: Record<string, string | undefined>): void {
  process.env = {
    ...ORIGINAL_ENV,
    GOOGLE_SHEETS_SPREADSHEET_ID: undefined,
    GOOGLE_SHEETS_STAGING_SPREADSHEET_ID: undefined,
    GOOGLE_SERVICE_ACCOUNT_JSON: undefined,
    AUTH_DISABLED: undefined,
    ...overrides,
  };
}

async function mirrorClassName(): Promise<string> {
  const { spreadsheetMirror } = await import('@/server/composition');
  return spreadsheetMirror().constructor.name;
}

describe('spreadsheetMirror() environment gating', () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('real production writes the LIVE sheet', async () => {
    setEnv({
      NODE_ENV: 'production',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'live-sheet',
      GOOGLE_SERVICE_ACCOUNT_JSON: FAKE_SA,
    });
    expect(await mirrorClassName()).toBe('GoogleSheetsSpreadsheetMirror');
  });

  it('staging NEVER writes the live sheet, even with the live id present', async () => {
    setEnv({
      NODE_ENV: 'production',
      AUTH_DISABLED: 'true', // staging: auth bypassed
      GOOGLE_SHEETS_SPREADSHEET_ID: 'live-sheet', // still carries the live id
      GOOGLE_SERVICE_ACCOUNT_JSON: FAKE_SA,
    });
    // No staging id => fake, and crucially it does NOT fall back to the live id.
    expect(await mirrorClassName()).toBe('FakeSpreadsheetMirror');
  });

  it('staging writes its OWN staging sheet when configured', async () => {
    setEnv({
      NODE_ENV: 'production',
      AUTH_DISABLED: 'true',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'live-sheet',
      GOOGLE_SHEETS_STAGING_SPREADSHEET_ID: 'staging-sheet',
      GOOGLE_SERVICE_ACCOUNT_JSON: FAKE_SA,
    });
    expect(await mirrorClassName()).toBe('GoogleSheetsSpreadsheetMirror');
  });

  it('dev never uses the live id (fake unless a staging id is set)', async () => {
    setEnv({
      NODE_ENV: 'development',
      GOOGLE_SHEETS_SPREADSHEET_ID: 'live-sheet',
      GOOGLE_SERVICE_ACCOUNT_JSON: FAKE_SA,
    });
    expect(await mirrorClassName()).toBe('FakeSpreadsheetMirror');
  });

  it('is the in-memory fake when no service-account creds are set', async () => {
    setEnv({ NODE_ENV: 'production', GOOGLE_SHEETS_SPREADSHEET_ID: 'live-sheet' });
    expect(await mirrorClassName()).toBe('FakeSpreadsheetMirror');
  });
});
