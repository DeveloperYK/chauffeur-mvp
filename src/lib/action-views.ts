/**
 * The rail's action views: presentational metadata only (ids, labels, groups,
 * colours). Every view is named for the operator's NEXT STEP, not the booking's
 * state, and the list is ordered along the booking lifecycle. The matching
 * queries live in `src/server/services/action-views.ts`; this file has no
 * server imports so the client-side rail can use it. See ADR 0021.
 */

export const ACTION_VIEW_GROUPS = [
  { id: 'todo', label: 'To do' },
  { id: 'waiting', label: 'Waiting on others' },
  { id: 'billing', label: 'Billing' },
] as const;

export type ActionViewGroupId = (typeof ACTION_VIEW_GROUPS)[number]['id'];

export interface ActionViewDef {
  id: ActionViewId;
  group: ActionViewGroupId;
  /** Imperative label shown in the rail and as the view page title. */
  name: string;
  /** One line stating the selection rule — shown under the view page title. */
  subtitle: string;
  /** Rail colour dot. */
  vdot: string;
}

export const ACTION_VIEW_IDS = [
  'to_dispatch',
  'driver_to_accept',
  'confirm_change',
  'send_form',
  'form_outstanding',
  'approve',
  'send_emails',
  'add_price',
] as const;

export type ActionViewId = (typeof ACTION_VIEW_IDS)[number];

export const ACTION_VIEWS: readonly ActionViewDef[] = [
  {
    id: 'to_dispatch',
    group: 'todo',
    name: 'Dispatch',
    subtitle: 'Bookings with no driver and no dispatch link out. Offer them to drivers.',
    vdot: '#8590A2',
  },
  {
    id: 'driver_to_accept',
    group: 'waiting',
    name: 'Driver to accept',
    subtitle:
      'Dispatch links sent, no driver has accepted yet. Turns red once a booking passes the no-accept window.',
    vdot: '#8590A2',
  },
  {
    id: 'confirm_change',
    group: 'todo',
    name: 'Tell driver of change',
    subtitle:
      'Dispatched bookings edited after the driver was told. Confirm the driver has the new plan.',
    vdot: '#C9372C',
  },
  {
    id: 'send_form',
    group: 'todo',
    name: 'Send completion form',
    subtitle:
      'Trips that have ended and still need the driver’s arrival, waiting and parking details. Send the form link, or enter the details yourself.',
    vdot: '#1F845A',
  },
  {
    id: 'form_outstanding',
    group: 'waiting',
    name: 'Driver form outstanding',
    subtitle:
      'Completion form sent, driver has not returned it. Turns red after 24 hours; chase the driver or enter the details yourself.',
    vdot: '#1F845A',
  },
  {
    id: 'approve',
    group: 'todo',
    name: 'Approve completion',
    subtitle: 'Driver forms returned and waiting for your review.',
    vdot: '#5243AA',
  },
  {
    id: 'send_emails',
    group: 'todo',
    name: 'Send exec emails',
    subtitle:
      'Bookings whose confirmation, driver-details or update email is due but unsent, or whose last send failed.',
    vdot: '#B38600',
  },
  {
    id: 'add_price',
    group: 'billing',
    name: 'Add price',
    subtitle: 'Live bookings with no contract price. They block the monthly invoice until priced.',
    vdot: '#E56910',
  },
];

const ID_SET: ReadonlySet<string> = new Set(ACTION_VIEW_IDS);

export function isActionViewId(value: string | undefined | null): value is ActionViewId {
  return typeof value === 'string' && ID_SET.has(value);
}

export function actionViewById(id: ActionViewId): ActionViewDef {
  const def = ACTION_VIEWS.find((v) => v.id === id);
  if (!def) throw new Error(`Unknown action view: ${id}`);
  return def;
}

export interface ActionViewCount {
  total: number;
  /** Subset of `total` that warrants a red badge. */
  urgent: number;
}

export type ActionViewCounts = Record<ActionViewId, ActionViewCount>;

export const ZERO_COUNTS: ActionViewCounts = Object.fromEntries(
  ACTION_VIEW_IDS.map((id) => [id, { total: 0, urgent: 0 }]),
) as ActionViewCounts;
