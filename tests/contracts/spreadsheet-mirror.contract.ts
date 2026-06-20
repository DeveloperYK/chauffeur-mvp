/**
 * Contract tests for SpreadsheetMirrorPort implementations.
 *
 * These tests verify that both FakeSpreadsheetMirror and GoogleSheetsSpreadsheetMirror
 * exhibit identical behavior for the same inputs.
 */

import type { MirrorRowInput, SpreadsheetMirrorPort } from '@/server/ports/spreadsheet-mirror';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Create a valid MirrorRowInput for testing.
 */
export function createValidMirrorInput(overrides: Partial<MirrorRowInput> = {}): MirrorRowInput {
  return {
    booking: {
      id: '00000000-0000-0000-0000-000000000001',
      seq: 1,
      state: 'completed',
      serviceType: 'transfer',
      pickupAt: new Date('2026-06-01T10:00:00.000Z'),
      expectedDurationMinutes: 90,
      distanceMeters: 28000,
      pickupAddress: '11 Belsize Park Gardens, London',
      dropoffAddress: 'Heathrow Terminal 5',
      passengerFirstName: 'Eric',
      passengerLastName: 'French',
      execMobile: '+447911999999',
      execEmail: null,
      clientName: 'LEGO Group',
      accountCode: 'LEGO',
      caseCode: 'LEGO-2026-001',
      contractPricePence: 30000,
      notes: 'VIP client',
      operatorNotes: null,
      createdByOperatorId: '00000000-0000-0000-0000-000000000010',
      assignedOperatorId: '00000000-0000-0000-0000-000000000010',
      assignedDriverId: '00000000-0000-0000-0000-000000000020',
      assignedAt: new Date('2026-05-20T10:00:00.000Z'),
      assignmentMethod: 'driver_self',
      carParkPence: 500,
      arrivalAt: new Date('2026-06-01T09:55:00.000Z'),
      passengerOnBoardAt: new Date('2026-06-01T10:10:00.000Z'),
      waitingTimeMinutes: 15,
      dropoffAt: new Date('2026-06-01T11:30:00.000Z'),
      completionSubmittedAt: new Date('2026-06-01T12:00:00.000Z'),
      approvedAt: new Date('2026-06-01T14:00:00.000Z'),
      approvedByOperatorId: '00000000-0000-0000-0000-000000000010',
      cancelledAt: null,
      cancelledByOperatorId: null,
      cancellationReason: null,
      flaggedAt: null,
      changeConfirmationStatus: 'none',
      changeExecRelevant: false,
      changePendingSince: null,
      changeConfirmedAt: null,
      changeConfirmedMethod: null,
      changeConfirmedByOperatorId: null,
      isBackfill: false,
      backfillDriverName: null,
      backfillDriverPhone: null,
      backfillCar: null,
      backfillDriverPayPence: null,
      completionByOperator: false,
      execNotificationStatus: 'none',
      createdAt: new Date('2026-05-18T10:00:00.000Z'),
      updatedAt: new Date('2026-06-01T14:00:00.000Z'),
    },
    driver: {
      id: '00000000-0000-0000-0000-000000000020',
      name: 'Tom Wright',
      vehicleClass: 'executive',
      car: 'Mercedes S-Class',
      carColour: 'Black',
      whatsappNumber: '+447911000001',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    operator: {
      id: '00000000-0000-0000-0000-000000000010',
      email: 'alice@example.com',
      passwordHash: 'hash',
      name: 'Alice Smith',
      active: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    ...overrides,
  };
}

/**
 * Shared contract test suite for any SpreadsheetMirrorPort implementation.
 */
export function spreadsheetMirrorContractTests(
  createAdapter: () => SpreadsheetMirrorPort,
  cleanup?: () => void,
) {
  describe('SpreadsheetMirrorPort contract', () => {
    let adapter: SpreadsheetMirrorPort;

    beforeEach(() => {
      adapter = createAdapter();
    });

    afterEach(() => {
      cleanup?.();
    });

    // ─── Happy Paths ──────────────────────────────────────────────────────────

    describe('upsertRow', () => {
      it('returns ok:true for valid complete booking', async () => {
        const input = createValidMirrorInput();

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });

      it('returns ok:true for booking without driver', async () => {
        const input = createValidMirrorInput({
          driver: null,
          booking: {
            ...createValidMirrorInput().booking,
            state: 'unassigned',
            assignedDriverId: null,
          },
        });

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });

      it('returns ok:true for booking without operator', async () => {
        const input = createValidMirrorInput({
          operator: null,
        });

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });

      it('returns ok:true for cancelled booking', async () => {
        const input = createValidMirrorInput({
          booking: {
            ...createValidMirrorInput().booking,
            state: 'cancelled',
            cancelledAt: new Date('2026-05-25T10:00:00.000Z'),
            cancelledByOperatorId: '00000000-0000-0000-0000-000000000010',
            cancellationReason: 'Executive cancelled',
          },
        });

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });

      it('handles booking with no notes', async () => {
        const input = createValidMirrorInput({
          booking: {
            ...createValidMirrorInput().booking,
            notes: null,
          },
        });

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });

      it('handles booking with no completion data', async () => {
        const input = createValidMirrorInput({
          booking: {
            ...createValidMirrorInput().booking,
            state: 'assigned',
            carParkPence: null,
            arrivalAt: null,
            passengerOnBoardAt: null,
            waitingTimeMinutes: null,
            dropoffAt: null,
            completionSubmittedAt: null,
            approvedAt: null,
            approvedByOperatorId: null,
          },
        });

        const result = await adapter.upsertRow(input);

        expect(result.ok).toBe(true);
      });
    });

    // ─── Idempotency ──────────────────────────────────────────────────────────

    describe('idempotency', () => {
      it('can upsert the same booking multiple times', async () => {
        const input = createValidMirrorInput();

        const result1 = await adapter.upsertRow(input);
        const result2 = await adapter.upsertRow(input);

        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
      });

      it('can upsert with updated data', async () => {
        const input1 = createValidMirrorInput({
          booking: {
            ...createValidMirrorInput().booking,
            state: 'assigned',
          },
        });

        const input2 = createValidMirrorInput({
          booking: {
            ...createValidMirrorInput().booking,
            state: 'completed',
          },
        });

        const result1 = await adapter.upsertRow(input1);
        const result2 = await adapter.upsertRow(input2);

        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
      });
    });
  });
}
