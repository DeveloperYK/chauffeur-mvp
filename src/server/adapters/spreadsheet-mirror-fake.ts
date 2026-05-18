import {
  type MirrorRowInput,
  type SpreadsheetMirrorPort,
  rowFromBooking,
} from '@/server/ports/spreadsheet-mirror';

export class FakeSpreadsheetMirror implements SpreadsheetMirrorPort {
  /** keyed by booking id */
  readonly rows = new Map<string, string[]>();

  async upsertRow(input: MirrorRowInput): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.rows.set(input.booking.id, rowFromBooking(input));
    return { ok: true };
  }

  reset(): void {
    this.rows.clear();
  }
}
