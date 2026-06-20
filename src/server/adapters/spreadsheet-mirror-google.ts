import { logger } from '@/lib/logger';
import {
  type MirrorRowInput,
  SHEET_HEADERS,
  SHEET_LAST_COLUMN,
  type SpreadsheetMirrorPort,
  rowFromBooking,
} from '@/server/ports/spreadsheet-mirror';
import { SignJWT, importPKCS8 } from 'jose';

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  /** Stringified JSON of a Google service-account credentials file. */
  serviceAccountJson: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sheetName?: string; // tab name, defaults to "Main Data" (the JJ table)
}

interface ServiceAccount {
  client_email: string;
  private_key: string; // PEM
  token_uri: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const TOKEN_LIFETIME_SECONDS = 3600;
const TOKEN_REFRESH_AHEAD_SECONDS = 60;
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export class GoogleSheetsSpreadsheetMirror implements SpreadsheetMirrorPort {
  private readonly sa: ServiceAccount;
  private readonly sheetName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  private accessToken: string | undefined;
  private accessTokenExpiresAt = 0;

  constructor(private readonly cfg: GoogleSheetsConfig) {
    if (!cfg.spreadsheetId) throw new Error('spreadsheetId required');
    if (!cfg.serviceAccountJson) throw new Error('serviceAccountJson required');
    let parsed: ServiceAccount;
    try {
      parsed = JSON.parse(cfg.serviceAccountJson) as ServiceAccount;
    } catch {
      throw new Error('serviceAccountJson is not valid JSON');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('serviceAccountJson missing client_email or private_key');
    }
    this.sa = parsed;
    this.sheetName = cfg.sheetName ?? 'Main Data';
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Upsert exactly one row per booking, keyed by Job # (column A). The sheet is
   * a revertible backup, so each booking must be a single, current row rather
   * than an append log. We read column A to find an existing row for this Job #:
   * found → overwrite it in place; not found → append. The header row is written
   * on first use so a brand-new empty sheet self-initialises.
   *
   * At MVP volume the extra read per write is negligible. If write throughput
   * ever matters, batch or cache the Job#→row index.
   */
  async upsertRow(input: MirrorRowInput): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const token = await this.getAccessToken();
      const row = rowFromBooking(input);
      const jobNumber = row[0] ?? '';

      const columnA = await this.readColumnA(token);
      const headerPresent = columnA[0]?.[0] === SHEET_HEADERS[0];
      if (!headerPresent) {
        const headerResult = await this.writeHeaders(token);
        if (!headerResult.ok) return headerResult;
      }

      // 1-based row number of the existing entry for this Job #, if any.
      const existingRowNumber = columnA.findIndex((cells) => cells[0] === jobNumber) + 1;
      if (existingRowNumber > 0) {
        return await this.updateRow(token, existingRowNumber, row);
      }
      return await this.appendRow(token, row);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, reason: 'timeout' };
      }
      logger.error({ err }, 'sheets upsert failed');
      return { ok: false, reason: 'network_error' };
    }
  }

  /** Idempotently ensure the header row exists. Safe to call at deploy. */
  async ensureHeaders(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const token = await this.getAccessToken();
      return await this.writeHeaders(token);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, reason: 'timeout' };
      }
      return { ok: false, reason: 'network_error' };
    }
  }

  /** Read column A (Job #) so we can locate the row for a given booking. */
  private async readColumnA(token: string): Promise<string[][]> {
    const range = `${encodeURIComponent(this.sheetName)}!A:A`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      this.cfg.spreadsheetId,
    )}/values/${range}?majorDimension=ROWS`;
    const res = await this.withTimeout((signal) =>
      this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      }),
    );
    if (!res.ok) {
      throw new Error(`sheets read column A failed: ${res.status}`);
    }
    const json = (await res.json()) as { values?: string[][] };
    return json.values ?? [];
  }

  private async writeHeaders(token: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.putValues(token, `A1:${SHEET_LAST_COLUMN}1`, Array.from(SHEET_HEADERS));
  }

  /** Overwrite the row at the given 1-based row number. */
  private async updateRow(
    token: string,
    rowNumber: number,
    row: string[],
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.putValues(token, `A${rowNumber}:${SHEET_LAST_COLUMN}${rowNumber}`, row);
  }

  private async putValues(
    token: string,
    a1Range: string,
    values: string[],
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const range = `${encodeURIComponent(this.sheetName)}!${a1Range}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      this.cfg.spreadsheetId,
    )}/values/${range}?valueInputOption=USER_ENTERED`;
    const res = await this.withTimeout((signal) =>
      this.fetchImpl(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ range, values: [values] }),
        signal,
      }),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn({ status: res.status, sheetsError: text.slice(0, 500) }, 'sheets write non-2xx');
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  }

  private async appendRow(
    token: string,
    row: string[],
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const range = `${encodeURIComponent(this.sheetName)}!A:${SHEET_LAST_COLUMN}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      this.cfg.spreadsheetId,
    )}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await this.withTimeout((signal) =>
      this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
        signal,
      }),
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn({ status: res.status, sheetsError: text.slice(0, 500) }, 'sheets append non-2xx');
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  }

  private async withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await fn(ctl.signal);
    } finally {
      clearTimeout(t);
    }
  }

  private async getAccessToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    if (this.accessToken && nowSec < this.accessTokenExpiresAt - TOKEN_REFRESH_AHEAD_SECONDS) {
      return this.accessToken;
    }
    const assertion = await this.signAssertion(nowSec);
    const tokenUri = this.sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    const res = await this.withTimeout((signal) =>
      this.fetchImpl(tokenUri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal,
      }),
    );
    if (!res.ok) {
      throw new Error(`token exchange failed: ${res.status}`);
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error('no access_token in response');
    this.accessToken = json.access_token;
    this.accessTokenExpiresAt = nowSec + (json.expires_in ?? TOKEN_LIFETIME_SECONDS);
    return this.accessToken;
  }

  private async signAssertion(nowSec: number): Promise<string> {
    const pkcs8 = this.sa.private_key.replace(/\\n/g, '\n');
    const key = await importPKCS8(pkcs8, 'RS256');
    return new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.sa.client_email)
      .setSubject(this.sa.client_email)
      .setAudience(this.sa.token_uri ?? 'https://oauth2.googleapis.com/token')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + TOKEN_LIFETIME_SECONDS)
      .sign(key);
  }
}
