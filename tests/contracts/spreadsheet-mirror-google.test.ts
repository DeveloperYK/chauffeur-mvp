/**
 * Contract + behaviour tests for GoogleSheetsSpreadsheetMirror.
 *
 * The adapter talks to the Google Sheets REST API over `fetch`. We inject a
 * fake `fetch` backed by an in-memory sheet so the same contract suite that
 * runs against FakeSpreadsheetMirror also runs here (behavioural equivalence),
 * plus adapter-specific tests for the upsert-keyed-by-Job# semantics.
 */

import { generateKeyPairSync } from 'node:crypto';
import { bookingRef } from '@/lib/booking-ref';
import { GoogleSheetsSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-google';
import { SHEET_HEADERS } from '@/server/ports/spreadsheet-mirror';
import { describe, expect, it } from 'vitest';
import {
  createValidMirrorInput,
  spreadsheetMirrorContractTests,
} from './spreadsheet-mirror.contract';

// A real RSA key so importPKCS8/JWT signing succeeds; the fake token endpoint
// accepts any signed assertion.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: 'mirror@example.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
});

interface FakeSheet {
  rows: string[][];
  fetch: typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** An in-memory Google Sheet that understands the four calls the adapter makes. */
function makeFakeSheet(): FakeSheet {
  const rows: string[][] = [];

  const setRow = (rowNumber: number, values: string[]): void => {
    while (rows.length < rowNumber) rows.push([]);
    rows[rowNumber - 1] = values;
  };

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';

    if (url.includes('oauth2.googleapis.com/token')) {
      return jsonResponse({ access_token: 'fake-access-token', expires_in: 3600 });
    }
    if (url.includes(':append')) {
      const body = JSON.parse(String(init?.body)) as { values: string[][] };
      rows.push(body.values[0] ?? []);
      return jsonResponse({});
    }
    if (method === 'GET') {
      // readColumnA — only column A is returned by Sheets for an A:A range.
      return jsonResponse({ values: rows.map((r) => [r[0] ?? '']) });
    }
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { range: string; values: string[][] };
      const match = /!A(\d+):/.exec(body.range);
      const rowNumber = match ? Number(match[1]) : 1;
      setRow(rowNumber, body.values[0] ?? []);
      return jsonResponse({});
    }
    return jsonResponse({ error: 'unexpected request' }, 400);
  }) as typeof fetch;

  return { rows, fetch: fetchImpl };
}

function createAdapterWithFakeSheet(): {
  adapter: GoogleSheetsSpreadsheetMirror;
  sheet: FakeSheet;
} {
  const sheet = makeFakeSheet();
  const adapter = new GoogleSheetsSpreadsheetMirror({
    spreadsheetId: 'test-spreadsheet-id',
    serviceAccountJson: SERVICE_ACCOUNT_JSON,
    fetchImpl: sheet.fetch,
  });
  return { adapter, sheet };
}

// Behavioural equivalence with the fake, against the shared contract suite.
spreadsheetMirrorContractTests(() => createAdapterWithFakeSheet().adapter);

describe('GoogleSheetsSpreadsheetMirror upsert semantics', () => {
  const base = createValidMirrorInput().booking;

  it('initialises the header row and writes the first booking as one data row', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    const result = await adapter.upsertRow(createValidMirrorInput());

    expect(result.ok).toBe(true);
    expect(sheet.rows).toHaveLength(2); // header + one booking
    expect(sheet.rows[0]).toEqual([...SHEET_HEADERS]);
    expect(sheet.rows[1]?.[0]).toBe(bookingRef(base.seq));
  });

  it('updates the same booking in place instead of appending a duplicate', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    await adapter.upsertRow(createValidMirrorInput({ booking: { ...base, state: 'assigned' } }));
    await adapter.upsertRow(
      createValidMirrorInput({
        booking: { ...base, state: 'completed', contractPricePence: 50000 },
      }),
    );

    expect(sheet.rows).toHaveLength(2); // header + exactly one booking row
    expect(sheet.rows[1]?.[0]).toBe(bookingRef(base.seq));
    expect(sheet.rows[1]?.[11]).toBe('500.00'); // Contract Price (L) reflects the update
  });

  it('appends a distinct booking on its own row', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    await adapter.upsertRow(createValidMirrorInput());
    await adapter.upsertRow(
      createValidMirrorInput({
        booking: { ...base, id: '00000000-0000-0000-0000-000000000002', seq: 2 },
      }),
    );

    expect(sheet.rows).toHaveLength(3); // header + two bookings
    expect(sheet.rows[1]?.[0]).toBe(bookingRef(base.seq));
    expect(sheet.rows[2]?.[0]).toBe(bookingRef(2));
  });

  it('does not rewrite the header row once it exists', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    await adapter.upsertRow(createValidMirrorInput());
    const headerAfterFirst = sheet.rows[0];
    await adapter.upsertRow(createValidMirrorInput({ booking: { ...base, state: 'completed' } }));

    expect(sheet.rows[0]).toBe(headerAfterFirst); // same array reference, untouched
    expect(sheet.rows).toHaveLength(2);
  });

  it('surfaces a non-2xx write as ok:false without throwing', async () => {
    const failing = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('oauth2.googleapis.com/token')) {
        return jsonResponse({ access_token: 't', expires_in: 3600 });
      }
      if ((init?.method ?? 'GET') === 'GET') return jsonResponse({ values: [] });
      return jsonResponse({ error: 'boom' }, 500);
    }) as typeof fetch;
    const adapter = new GoogleSheetsSpreadsheetMirror({
      spreadsheetId: 'id',
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      fetchImpl: failing,
    });

    const result = await adapter.upsertRow(createValidMirrorInput());

    expect(result).toEqual({ ok: false, reason: 'http_500' });
  });
});
