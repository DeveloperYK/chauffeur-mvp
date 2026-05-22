/**
 * Contract tests for FakeSpreadsheetMirror.
 */

import { FakeSpreadsheetMirror } from '@/server/adapters/spreadsheet-mirror-fake';
import { describe } from 'vitest';
import { spreadsheetMirrorContractTests } from './spreadsheet-mirror.contract';

describe('FakeSpreadsheetMirror', () => {
  let adapter: FakeSpreadsheetMirror;

  spreadsheetMirrorContractTests(
    () => {
      adapter = new FakeSpreadsheetMirror();
      return adapter;
    },
    () => {
      adapter.reset();
    },
  );
});
