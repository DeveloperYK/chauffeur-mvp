import { type MobileActionInput, mobileActionsFor } from '@/lib/mobile-actions';
import type { BookingState } from '@/server/db/schema';
import { describe, expect, it } from 'vitest';

const CONTACT = { name: 'Mario Rossi', phone: '+447700900001' };

function input(state: BookingState, extra: Partial<MobileActionInput> = {}): MobileActionInput {
  return {
    state,
    openOfferCount: 0,
    passengerName: 'Eric French',
    execMobile: null,
    ...extra,
  };
}

const kinds = (list: ReturnType<typeof mobileActionsFor>) => list.map((a) => a.kind);

describe('lib/mobile-actions mobileActionsFor', () => {
  it('unassigned: find a driver is primary, then edit and cancel', () => {
    const actions = mobileActionsFor(input('unassigned'), null);
    expect(kinds(actions)).toEqual(['dispatch', 'edit', 'cancel']);
    expect(actions[0]).toMatchObject({ label: 'Find a driver', primary: true, tone: 'primary' });
    expect(actions[2]).toMatchObject({ tone: 'danger', primary: false });
  });

  it('unassigned with open offers: the primary offers to more drivers', () => {
    const [first] = mobileActionsFor(input('unassigned', { openOfferCount: 2 }), null);
    expect(first).toMatchObject({ kind: 'dispatch', label: 'Offer to more drivers' });
  });

  it('assigned with a driver: WhatsApp is primary, call, release, reassign, edit, cancel', () => {
    const actions = mobileActionsFor(input('assigned'), CONTACT);
    expect(kinds(actions)).toEqual(['whatsapp', 'call', 'release', 'dispatch', 'edit', 'cancel']);
    expect(actions[0]?.href).toMatch(/^https:\/\/wa\.me\/447700900001\?text=/);
    expect(actions[0]?.href).toContain(encodeURIComponent('Hi Mario'));
    expect(actions[1]?.href).toBe('tel:+447700900001');
    // Stored numbers are free text: only digits and the leading + reach the URI.
    const messy = mobileActionsFor(input('assigned'), { name: 'M', phone: '+44 7700 900001;x' });
    expect(messy[1]?.href).toBe('tel:+447700900001');
    expect(actions[3]?.label).toBe('Reassign driver');
  });

  it('assigned without a contact: release becomes the first action', () => {
    const actions = mobileActionsFor(input('assigned'), null);
    expect(kinds(actions)).toEqual(['release', 'dispatch', 'edit', 'cancel']);
    expect(actions[0]?.primary).toBe(true);
  });

  it('in progress: call driver is primary; passenger SMS only when a mobile is known', () => {
    const withExec = mobileActionsFor(
      input('in_progress', { execMobile: '+447911123456' }),
      CONTACT,
    );
    expect(kinds(withExec)).toEqual(['call', 'whatsapp', 'sms_passenger', 'edit']);
    expect(withExec[2]?.href).toMatch(/^sms:\+447911123456\?body=/);
    const noExec = mobileActionsFor(input('in_progress'), CONTACT);
    expect(kinds(noExec)).toEqual(['call', 'whatsapp', 'edit']);
  });

  it('awaiting driver form: nudge the driver on WhatsApp, else just edit', () => {
    expect(kinds(mobileActionsFor(input('awaiting_driver_form'), CONTACT))).toEqual([
      'whatsapp',
      'edit',
    ]);
    expect(kinds(mobileActionsFor(input('awaiting_driver_form'), null))).toEqual(['edit']);
  });

  it('awaiting operator review: approve is primary and green, reject is danger', () => {
    const actions = mobileActionsFor(input('awaiting_operator_review'), CONTACT);
    expect(kinds(actions)).toEqual(['approve', 'reject', 'edit']);
    expect(actions[0]).toMatchObject({ primary: true, tone: 'success' });
    expect(actions[1]).toMatchObject({ tone: 'danger' });
  });

  it('completed can still be corrected; cancelled has nothing', () => {
    expect(kinds(mobileActionsFor(input('completed'), null))).toEqual(['edit']);
    expect(mobileActionsFor(input('cancelled'), null)).toEqual([]);
  });

  it('exactly one action is primary whenever there are any', () => {
    const states: BookingState[] = [
      'unassigned',
      'assigned',
      'in_progress',
      'awaiting_driver_form',
      'awaiting_operator_review',
      'completed',
    ];
    for (const s of states) {
      const actions = mobileActionsFor(input(s), CONTACT);
      expect(actions.filter((a) => a.primary)).toHaveLength(1);
    }
  });
});
