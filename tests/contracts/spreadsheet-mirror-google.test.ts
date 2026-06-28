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

interface ColumnFormat {
  columnIndex: number;
  type: string;
  pattern: string;
}

interface FakeSheet {
  rows: string[][];
  /** Currency formats applied via repeatCell, captured per money column. */
  formats: ColumnFormat[];
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
  const formats: ColumnFormat[] = [];

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
    if (url.includes(':batchUpdate')) {
      // Two batchUpdate shapes: deleteDimension (remove a row range) and
      // repeatCell (apply a number format to the money columns).
      const body = JSON.parse(String(init?.body)) as {
        requests: {
          deleteDimension?: { range: { startIndex: number; endIndex: number } };
          repeatCell?: {
            range: { startColumnIndex: number };
            cell: { userEnteredFormat: { numberFormat: { type: string; pattern: string } } };
          };
        }[];
      };
      for (const req of body.requests) {
        if (req.deleteDimension) {
          const { startIndex, endIndex } = req.deleteDimension.range;
          rows.splice(startIndex, endIndex - startIndex);
        }
        if (req.repeatCell) {
          const nf = req.repeatCell.cell.userEnteredFormat.numberFormat;
          formats.push({
            columnIndex: req.repeatCell.range.startColumnIndex,
            type: nf.type,
            pattern: nf.pattern,
          });
        }
      }
      return jsonResponse({});
    }
    if (method === 'GET' && url.includes('fields=sheets.properties')) {
      // Spreadsheet metadata — the adapter resolves the tab's numeric gid here.
      return jsonResponse({ sheets: [{ properties: { sheetId: 0, title: 'Main Data' } }] });
    }
    if (method === 'GET') {
      // readColumnA — only column A is returned by Sheets for an A:A range.
      return jsonResponse({ values: rows.map((r) => [r[0] ?? '']) });
    }
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as { range: string; values: string[][] };
      // Google rejects a write whose body `range` is percent-encoded while the
      // URL range decodes to plain text — guard against that regression here.
      if (body.range.includes('%')) {
        return jsonResponse(
          { error: { code: 400, message: `body range must be plain, got ${body.range}` } },
          400,
        );
      }
      const match = /!A(\d+):/.exec(body.range);
      const rowNumber = match ? Number(match[1]) : 1;
      setRow(rowNumber, body.values[0] ?? []);
      return jsonResponse({});
    }
    return jsonResponse({ error: 'unexpected request' }, 400);
  }) as typeof fetch;

  return { rows, formats, fetch: fetchImpl };
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

  it('sets a currency format on the money columns (Contract Price L, Driver Cost O, Car Park P)', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    await adapter.upsertRow(createValidMirrorInput());

    const formattedColumns = sheet.formats.map((f) => f.columnIndex).sort((a, b) => a - b);
    expect(formattedColumns).toEqual([11, 14, 15]);
    for (const f of sheet.formats) {
      expect(f.type).toBe('CURRENCY');
      expect(f.pattern).toBe('£#,##0.00');
    }
  });

  it('applies the currency format only once across many upserts', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();

    await adapter.upsertRow(createValidMirrorInput());
    await adapter.upsertRow(createValidMirrorInput({ booking: { ...base, state: 'assigned' } }));
    await adapter.upsertRow(createValidMirrorInput({ booking: { ...base, state: 'completed' } }));

    // 3 money columns formatted exactly once, not re-sent on every write.
    expect(sheet.formats).toHaveLength(3);
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

  it('deleteRow removes the booking row entirely, closing the gap', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();
    const second = createValidMirrorInput({
      booking: { ...base, id: '00000000-0000-0000-0000-000000000002', seq: 2 },
    });
    await adapter.upsertRow(createValidMirrorInput());
    await adapter.upsertRow(second);
    expect(sheet.rows).toHaveLength(3); // header + two bookings

    const result = await adapter.deleteRow(base);

    expect(result.ok).toBe(true);
    expect(sheet.rows).toHaveLength(2); // header + remaining booking — no blank gap
    expect(sheet.rows[0]).toEqual([...SHEET_HEADERS]);
    expect(sheet.rows[1]?.[0]).toBe(bookingRef(2)); // booking #2 shifted up into row 2
  });

  it('deleteRow is a no-op success when the booking is not in the sheet', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();
    await adapter.upsertRow(createValidMirrorInput()); // header + booking #1

    const result = await adapter.deleteRow({
      ...base,
      id: '00000000-0000-0000-0000-000000000099',
      seq: 99,
    });

    expect(result.ok).toBe(true);
    expect(sheet.rows).toHaveLength(2); // unchanged
  });

  it('writes booking rows beneath a mid-sheet template header, leaving it untouched', async () => {
    const { adapter, sheet } = createAdapterWithFakeSheet();
    // Simulate the JJ template: reference rows + group bands occupy rows 1–12,
    // then the "Job #" header sits at row 13 with the data area beneath it.
    for (let i = 0; i < 12; i++) sheet.rows.push([`ref-${i}`]);
    sheet.rows.push([...SHEET_HEADERS]); // row 13 = header
    const headerRowRef = sheet.rows[12];

    const first = await adapter.upsertRow(createValidMirrorInput());
    expect(first.ok).toBe(true);
    expect(sheet.rows).toHaveLength(14); // 13 template rows + one booking
    expect(sheet.rows[12]).toBe(headerRowRef); // header row untouched (same ref)
    expect(sheet.rows[13]?.[0]).toBe(bookingRef(base.seq)); // booking lands at row 14

    // Re-upserting the same booking updates row 14 in place — no duplicate row.
    await adapter.upsertRow(
      createValidMirrorInput({ booking: { ...base, contractPricePence: 99900 } }),
    );
    expect(sheet.rows).toHaveLength(14);
    expect(sheet.rows[13]?.[11]).toBe('999.00'); // Contract Price (L) reflects the update
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
