import type { BookingState } from '@/server/db/schema';
import { whatsappMobileLink } from './whatsapp';

/**
 * The actions the mobile booking screen offers for each state, in order. The
 * first one is the primary (big) button: on a phone the operator should see
 * one obvious thing to do. Mirrors the desktop detail panel's per-state menu
 * minus the desk-only tools (completion link, exec emails),
 * which the screen points at the full console for.
 */

export type MobileActionKind =
  | 'dispatch'
  | 'edit'
  | 'cancel'
  | 'approve'
  | 'reject'
  | 'release'
  | 'call'
  | 'whatsapp'
  | 'sms_passenger';

export type MobileActionTone = 'primary' | 'default' | 'danger' | 'success';

export interface MobileAction {
  kind: MobileActionKind;
  label: string;
  tone: MobileActionTone;
  primary: boolean;
  /** Set for link actions (tel:, sms:, WhatsApp); button actions have none. */
  href?: string;
}

export interface MobileActionInput {
  state: BookingState;
  openOfferCount: number;
  passengerName: string;
  execMobile: string | null;
}

export interface DriverContact {
  name: string;
  phone: string;
}

type Draft = Omit<MobileAction, 'primary'>;

const EDIT: Draft = { kind: 'edit', label: 'Edit booking', tone: 'default' };
const CANCEL: Draft = { kind: 'cancel', label: 'Cancel booking', tone: 'danger' };

/** Stored numbers are free text; only a leading + and digits may reach a tel:/sms: URI. */
export function dialable(number: string): string {
  const trimmed = number.trim();
  return (trimmed.startsWith('+') ? '+' : '') + trimmed.replace(/\D/g, '');
}

function firstName(contact: DriverContact): string {
  return contact.name.split(' ')[0] ?? contact.name;
}

function whatsapp(contact: DriverContact, label: string, text: string): Draft {
  return {
    kind: 'whatsapp',
    label,
    tone: 'default',
    href: whatsappMobileLink(contact.phone, text),
  };
}

function call(contact: DriverContact): Draft {
  return {
    kind: 'call',
    label: 'Call driver',
    tone: 'default',
    href: `tel:${dialable(contact.phone)}`,
  };
}

function draftsFor(input: MobileActionInput, contact: DriverContact | null): Draft[] {
  switch (input.state) {
    case 'unassigned':
      return [
        {
          kind: 'dispatch',
          label: input.openOfferCount > 0 ? 'Offer to more drivers' : 'Find a driver',
          tone: 'primary',
        },
        EDIT,
        CANCEL,
      ];
    case 'assigned':
      return [
        ...(contact
          ? [
              whatsapp(
                contact,
                'Message driver on WhatsApp',
                `Hi ${firstName(contact)}, about the ${input.passengerName} job…`,
              ),
              call(contact),
            ]
          : []),
        { kind: 'release', label: 'Driver pulled out — unassign', tone: 'default' },
        { kind: 'dispatch', label: 'Reassign driver', tone: 'default' },
        EDIT,
        CANCEL,
      ];
    case 'in_progress':
      return [
        ...(contact
          ? [call(contact), whatsapp(contact, 'Message driver', `Hi ${firstName(contact)}…`)]
          : []),
        ...(input.execMobile
          ? [
              {
                kind: 'sms_passenger',
                label: 'Message passenger (SMS)',
                tone: 'default',
                href: `sms:${dialable(input.execMobile)}?body=${encodeURIComponent(
                  `Hi, an update on your ${input.passengerName} booking…`,
                )}`,
              } as Draft,
            ]
          : []),
        EDIT,
      ];
    case 'awaiting_driver_form':
      return [
        ...(contact
          ? [
              whatsapp(
                contact,
                'Ask driver to complete the form',
                `Hi ${firstName(contact)}, please complete the form for ${input.passengerName}.`,
              ),
            ]
          : []),
        EDIT,
      ];
    case 'awaiting_operator_review':
      return [
        { kind: 'approve', label: 'Approve & complete', tone: 'success' },
        { kind: 'reject', label: 'Reject — driver to resubmit', tone: 'danger' },
        EDIT,
      ];
    case 'completed':
      return [EDIT];
    default:
      return [];
  }
}

export function mobileActionsFor(
  input: MobileActionInput,
  contact: DriverContact | null,
): MobileAction[] {
  return draftsFor(input, contact).map((d, i) =>
    i === 0
      ? { ...d, primary: true, tone: d.tone === 'default' ? 'primary' : d.tone }
      : { ...d, primary: false },
  );
}
