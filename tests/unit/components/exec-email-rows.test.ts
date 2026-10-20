import { execEmailRows } from '@/components/console/exec-email-due';
import { describe, expect, it } from 'vitest';

// The consolidated "Exec emails" card lists the manual emails the operator
// owes the exec. The rows are derived from the same booking slice as
// `execEmailsDue`, so the card, the tile tag and the hero pill agree.

const SENT = '2026-10-15T10:00:00Z';
const LATER = '2026-10-15T11:00:00Z';

const base = {
  state: 'assigned',
  assignedDriverId: 'drv_1',
  confirmationEmailSentAt: null as string | null,
  driverDetailsEmailSentAt: null as string | null,
  changeConfirmationStatus: 'none',
  changeExecRelevant: false,
  changeConfirmedAt: null as string | null,
  changeUpdateEmailSentAt: null as string | null,
  confirmationEmailWaivedAt: null as string | null,
  driverDetailsEmailWaivedAt: null as string | null,
  changeUpdateEmailWaivedAt: null as string | null,
};

describe('execEmailRows', () => {
  it('shows confirmation + driver details, both flagged, once a driver is on the job', () => {
    const rows = execEmailRows(base);
    expect(rows.map((r) => r.kind)).toEqual(['assigned', 'en_route']);
    expect(rows.every((r) => r.flagged && r.canSend && r.sentAt === null)).toBe(true);
  });

  it('marks a row sent (and unflagged) once its email has gone out', () => {
    const [confirmation, details] = execEmailRows({ ...base, confirmationEmailSentAt: SENT });
    expect(confirmation).toMatchObject({ sentAt: SENT, flagged: false, canSend: true });
    expect(details).toMatchObject({ sentAt: null, flagged: true });
  });

  it('adds the "Booking update" row, flagged, after a confirmed exec-relevant change', () => {
    const rows = execEmailRows({
      ...base,
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: SENT,
    });
    expect(rows[2]).toMatchObject({ kind: 'changed', sentAt: null, flagged: true, canSend: true });
  });

  it('keeps the update row unflagged with its timestamp once sent after the confirmation', () => {
    const rows = execEmailRows({
      ...base,
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: SENT,
      changeUpdateEmailSentAt: LATER,
    });
    expect(rows[2]).toMatchObject({ kind: 'changed', sentAt: LATER, flagged: false });
  });

  it('re-flags the update row when a newer change was confirmed after the last update email', () => {
    const rows = execEmailRows({
      ...base,
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: LATER,
      changeUpdateEmailSentAt: SENT,
    });
    expect(rows[2]).toMatchObject({ kind: 'changed', sentAt: null, flagged: true });
  });

  it('omits the update row when no change is relevant and none was ever sent', () => {
    expect(execEmailRows(base)).toHaveLength(2);
  });

  it('does not flag anything, and blocks driver details, while unassigned', () => {
    const [confirmation, details] = execEmailRows({
      ...base,
      state: 'unassigned',
      assignedDriverId: null,
    });
    expect(confirmation).toMatchObject({ flagged: false, canSend: true });
    expect(details).toMatchObject({
      flagged: false,
      canSend: false,
      disabledHint: 'Needs a driver on the job',
    });
  });

  it('disables every send and clears every flag on a cancelled booking', () => {
    const rows = execEmailRows({
      ...base,
      state: 'cancelled',
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: SENT,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.canSend && !r.flagged)).toBe(true);
  });
});

describe('execEmailRows — waived ("mark as handled")', () => {
  const waived = { ...base, confirmationEmailWaivedAt: SENT };

  it('shows a waived row as handled, unflagged and still sendable', () => {
    const [confirmation] = execEmailRows(waived);
    expect(confirmation).toMatchObject({
      sentAt: null,
      waivedAt: SENT,
      flagged: false,
      canSend: true,
    });
  });

  it('a sent row is reported as sent even if it was also waived', () => {
    const [confirmation] = execEmailRows({ ...waived, confirmationEmailSentAt: LATER });
    expect(confirmation).toMatchObject({ sentAt: LATER, flagged: false });
  });

  it('the update row counts a waiver made after the confirmation, not one before it', () => {
    const changed = {
      ...base,
      changeConfirmationStatus: 'confirmed',
      changeExecRelevant: true,
      changeConfirmedAt: SENT,
    };
    expect(execEmailRows({ ...changed, changeUpdateEmailWaivedAt: LATER })[2]).toMatchObject({
      flagged: false,
      waivedAt: LATER,
    });
    const earlier = '2026-10-15T09:00:00Z';
    expect(execEmailRows({ ...changed, changeUpdateEmailWaivedAt: earlier })[2]).toMatchObject({
      flagged: true,
      waivedAt: null,
    });
  });
});
