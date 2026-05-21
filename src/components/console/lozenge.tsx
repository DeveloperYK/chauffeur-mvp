import type { BookingState } from '@/server/db/schema';
import type { ReactNode } from 'react';

type Tone = 'gray' | 'blue' | 'yellow' | 'orange' | 'purple' | 'green' | 'red';

export function Lozenge({
  tone = 'gray',
  lg = false,
  children,
}: {
  tone?: Tone;
  lg?: boolean;
  children: ReactNode;
}) {
  return <span className={`lz tone-${tone} ${lg ? 'lz--lg' : ''}`}>{children}</span>;
}

export const STATE_TONE: Record<BookingState, Tone> = {
  unassigned: 'gray',
  assigned: 'blue',
  in_progress: 'yellow',
  awaiting_driver_form: 'orange',
  awaiting_operator_review: 'purple',
  completed: 'green',
  cancelled: 'gray',
};

/** All-caps lozenge label per state. */
export const STATE_LOZENGE: Record<BookingState, string> = {
  unassigned: 'UNASSIGNED',
  assigned: 'ASSIGNED',
  in_progress: 'IN PROGRESS',
  awaiting_driver_form: 'AWAITING FORM',
  awaiting_operator_review: 'AWAITING REVIEW',
  completed: 'DONE',
  cancelled: 'CANCELLED',
};

/** Column header label per state. */
export const COL_LABEL: Record<BookingState, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  in_progress: 'In progress',
  awaiting_driver_form: 'Awaiting form',
  awaiting_operator_review: 'Awaiting review',
  completed: 'Done',
  cancelled: 'Cancelled',
};

export function StateLozenge({ state, lg = false }: { state: BookingState; lg?: boolean }) {
  return (
    <Lozenge tone={STATE_TONE[state]} lg={lg}>
      {STATE_LOZENGE[state]}
    </Lozenge>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}
