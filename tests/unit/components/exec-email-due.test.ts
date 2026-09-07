import { execEmailsDue, execHealthLabel } from '@/components/console/exec-email-due';
import { describe, expect, it } from 'vitest';

// The board tile, the panel's hero pill and the panel's "Exec emails" rows all
// need one answer to "does the operator still owe the exec an email?". Keeping
// the rule in one place stops the pill saying "notified" while the tile says
// "email due" for the same booking.

const base = {
  state: 'assigned',
  assignedDriverId: 'drv_1',
  isBackfill: false,
  confirmationEmailSentAt: null as string | null,
  driverDetailsEmailSentAt: null as string | null,
  changeConfirmationStatus: 'none',
  changeExecRelevant: false,
  changeConfirmedAt: null as string | null,
  changeUpdateEmailSentAt: null as string | null,
};

describe('execEmailsDue', () => {
  it('is due when a driver is on the job and neither email has been sent', () => {
    expect(execEmailsDue(base)).toBe(true);
  });

  it('is still due when only the confirmation has been sent', () => {
    expect(execEmailsDue({ ...base, confirmationEmailSentAt: '2026-09-07T10:00:00Z' })).toBe(true);
  });

  it('is still due when only the driver details have been sent', () => {
    expect(execEmailsDue({ ...base, driverDetailsEmailSentAt: '2026-09-07T10:00:00Z' })).toBe(true);
  });

  it('is not due once both emails have been sent', () => {
    expect(
      execEmailsDue({
        ...base,
        confirmationEmailSentAt: '2026-09-07T10:00:00Z',
        driverDetailsEmailSentAt: '2026-09-07T10:05:00Z',
      }),
    ).toBe(false);
  });

  it('counts a backfill driver as a driver on the job', () => {
    expect(execEmailsDue({ ...base, assignedDriverId: null, isBackfill: true })).toBe(true);
  });

  it('is not due while the booking is unassigned', () => {
    expect(execEmailsDue({ ...base, state: 'unassigned', assignedDriverId: null })).toBe(false);
  });

  it('is not due for a cancelled booking even with a driver', () => {
    expect(execEmailsDue({ ...base, state: 'cancelled' })).toBe(false);
  });

  it('is not due for a completed booking that never got its emails', () => {
    expect(execEmailsDue({ ...base, state: 'completed' })).toBe(false);
  });

  it('is due when a confirmed exec-relevant change has no update email since', () => {
    expect(
      execEmailsDue({
        ...base,
        confirmationEmailSentAt: '2026-09-07T10:00:00Z',
        driverDetailsEmailSentAt: '2026-09-07T10:05:00Z',
        changeConfirmationStatus: 'confirmed',
        changeExecRelevant: true,
        changeConfirmedAt: '2026-09-07T11:00:00Z',
        changeUpdateEmailSentAt: '2026-09-07T10:30:00Z',
      }),
    ).toBe(true);
  });

  it('is not due once the update email was sent after the confirmation', () => {
    expect(
      execEmailsDue({
        ...base,
        confirmationEmailSentAt: '2026-09-07T10:00:00Z',
        driverDetailsEmailSentAt: '2026-09-07T10:05:00Z',
        changeConfirmationStatus: 'confirmed',
        changeExecRelevant: true,
        changeConfirmedAt: '2026-09-07T11:00:00Z',
        changeUpdateEmailSentAt: '2026-09-07T11:10:00Z',
      }),
    ).toBe(false);
  });

  it('ignores a confirmed change the exec does not care about', () => {
    expect(
      execEmailsDue({
        ...base,
        confirmationEmailSentAt: '2026-09-07T10:00:00Z',
        driverDetailsEmailSentAt: '2026-09-07T10:05:00Z',
        changeConfirmationStatus: 'confirmed',
        changeExecRelevant: false,
        changeConfirmedAt: '2026-09-07T11:00:00Z',
      }),
    ).toBe(false);
  });

  it('never nags for an update email on a cancelled booking', () => {
    expect(
      execEmailsDue({
        ...base,
        state: 'cancelled',
        changeConfirmationStatus: 'confirmed',
        changeExecRelevant: true,
        changeConfirmedAt: '2026-09-07T11:00:00Z',
      }),
    ).toBe(false);
  });
});

describe('execHealthLabel', () => {
  it('shows nothing when no message exists and nothing is due', () => {
    expect(execHealthLabel('none', false)).toBeNull();
  });

  it('shows "due" when nothing has been sent yet but an email is owed', () => {
    expect(execHealthLabel('none', true)).toEqual({ tone: 'orange', label: 'EXEC EMAIL DUE' });
  });

  it('shows "due", not "notified", when one of two emails is delivered', () => {
    expect(execHealthLabel('ok', true)).toEqual({ tone: 'orange', label: 'EXEC EMAIL DUE' });
  });

  it('shows "notified" only when everything is delivered and nothing is due', () => {
    expect(execHealthLabel('ok', false)).toEqual({ tone: 'green', label: 'EXEC NOTIFIED' });
  });

  it('a failure outranks a due email', () => {
    expect(execHealthLabel('failed', true)).toEqual({ tone: 'red', label: 'EXEC MESSAGE FAILED' });
  });

  it('a pending delivery is reported as pending when nothing else is due', () => {
    expect(execHealthLabel('pending', false)).toEqual({
      tone: 'orange',
      label: 'EXEC EMAIL PENDING',
    });
  });

  it('a due email outranks a pending delivery — the operator still has to act', () => {
    expect(execHealthLabel('pending', true)).toEqual({ tone: 'orange', label: 'EXEC EMAIL DUE' });
  });
});
