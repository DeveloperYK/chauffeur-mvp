'use client';
import { bookingRef } from '@/lib/booking-ref';
import type { BookingState } from '@/server/db/schema';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, UnassignedAvatar } from './avatar';
import { BackfillModal } from './backfill-modal';
import { CancelModal } from './cancel-modal';
import { CompleteFormModal } from './complete-form-modal';
import { DetailPanel } from './detail-panel';
import { DispatchModal } from './dispatch-modal';
import { EditBookingModal } from './edit-booking-modal';
import { fmtPrice, fmtTime, fmtTimeWithDay, passengerName, truncate } from './format';
import { Icon } from './icons';
import { COL_LABEL, Lozenge, StateLozenge, Tag } from './lozenge';
import { NewBookingModal } from './new-booking-modal';
import type { AssignmentWindow, ConsoleBooking, ConsoleDriver, ConsoleOperator } from './types';

const STATE_ORDER: BookingState[] = [
  'unassigned',
  'assigned',
  'in_progress',
  'awaiting_driver_form',
  'awaiting_operator_review',
  'completed',
  'cancelled',
];

const CLOSED_STATES: BookingState[] = ['completed', 'cancelled'];

interface Toast {
  id: string;
  text: string;
}

interface ConsoleBoardProps {
  bookings: ConsoleBooking[];
  drivers: ConsoleDriver[];
  operators: ConsoleOperator[];
  assignments: AssignmentWindow[];
  me: { id: string; name: string };
  layout: 'board' | 'list';
  showDone: boolean;
  /** Selected day is before today — show a completed-bookings view, not the live workflow columns. */
  isPast: boolean;
  initialNewOpen?: boolean;
}

export function ConsoleBoard({
  bookings,
  drivers,
  operators,
  assignments,
  me,
  layout,
  showDone,
  isPast,
  initialNewOpen = false,
}: ConsoleBoardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [completeFormOpen, setCompleteFormOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(initialNewOpen);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const operatorById = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const selected = useMemo(
    () => bookings.find((b) => b.id === selectedId) ?? null,
    [bookings, selectedId],
  );

  const pushToast = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  // Open the create modal from the topbar "Create" button (different subtree).
  useEffect(() => {
    const open = () => setNewOpen(true);
    window.addEventListener('console:new-booking', open);
    return () => window.removeEventListener('console:new-booking', open);
  }, []);

  // Keyboard: Esc closes the topmost overlay, ⌘N opens create.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cancelOpen) setCancelOpen(false);
        else if (editOpen) setEditOpen(false);
        else if (dispatchOpen) setDispatchOpen(false);
        else if (backfillOpen) setBackfillOpen(false);
        else if (completeFormOpen) setCompleteFormOpen(false);
        else if (newOpen) setNewOpen(false);
        else if (panelOpen) setPanelOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setNewOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cancelOpen, editOpen, dispatchOpen, backfillOpen, completeFormOpen, newOpen, panelOpen]);

  const onSelect = (id: string) => {
    setSelectedId(id);
    setPanelOpen(true);
  };

  const handleMutated = (toast: string, close = false) => {
    pushToast(toast);
    if (close) setPanelOpen(false);
    router.refresh();
  };

  // After creating a booking, jump the board to the booking's day (it defaults
  // to tomorrow) so the operator sees it land in Unassigned. Clears any active
  // saved view but preserves layout/show-done preferences.
  const handleCreated = (bookingDay?: string) => {
    setNewOpen(false);
    pushToast('Booking created.');
    if (!bookingDay) {
      router.refresh();
      return;
    }
    const p = new URLSearchParams(searchParams.toString());
    p.set('date', bookingDay);
    p.set('calMonth', bookingDay.slice(0, 7));
    p.delete('savedView');
    p.delete('new');
    router.push(`/dashboard?${p.toString()}`);
  };

  const cols = showDone ? STATE_ORDER : STATE_ORDER.filter((s) => !CLOSED_STATES.includes(s));
  const grouped = useMemo(() => {
    const map = {} as Record<BookingState, ConsoleBooking[]>;
    for (const s of STATE_ORDER) map[s] = [];
    for (const b of bookings) map[b.state]?.push(b);
    return map;
  }, [bookings]);

  const listVisible = useMemo(
    () =>
      bookings
        .filter((b) => showDone || !CLOSED_STATES.includes(b.state))
        .slice()
        .sort((a, b) => new Date(a.pickupAt).getTime() - new Date(b.pickupAt).getTime()),
    [bookings, showDone],
  );

  // Past days are history: everything that ran on the day, split into the jobs
  // that happened (completed/whatever they finished as) and the cancelled ones.
  const pastGroups = useMemo(() => {
    const sorted = bookings
      .slice()
      .sort((a, b) => new Date(a.pickupAt).getTime() - new Date(b.pickupAt).getTime());
    return {
      completed: sorted.filter((b) => b.state !== 'cancelled'),
      cancelled: sorted.filter((b) => b.state === 'cancelled'),
    };
  }, [bookings]);

  return (
    <>
      <div className="content">
        {isPast ? (
          <div className="list">
            <div className="list__row head">
              <span />
              <span>Pickup</span>
              <span>Customer</span>
              <span>Route</span>
              <span>Driver</span>
              <span>Status</span>
              <span>Assignee</span>
              <span style={{ textAlign: 'right' }}>Price</span>
            </div>
            <div className="list__section">Completed bookings · {pastGroups.completed.length}</div>
            {pastGroups.completed.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                No bookings ran on this day.
              </div>
            ) : (
              pastGroups.completed.map((b) => (
                <ListRow
                  key={b.id}
                  booking={b}
                  driver={b.assignedDriverId ? driverById.get(b.assignedDriverId) : undefined}
                  assignee={
                    b.assignedOperatorId ? operatorById.get(b.assignedOperatorId) : undefined
                  }
                  selected={selectedId === b.id}
                  onClick={() => onSelect(b.id)}
                />
              ))
            )}
            {pastGroups.cancelled.length > 0 ? (
              <>
                <div className="list__section">Cancelled · {pastGroups.cancelled.length}</div>
                {pastGroups.cancelled.map((b) => (
                  <ListRow
                    key={b.id}
                    booking={b}
                    driver={b.assignedDriverId ? driverById.get(b.assignedDriverId) : undefined}
                    assignee={
                      b.assignedOperatorId ? operatorById.get(b.assignedOperatorId) : undefined
                    }
                    selected={selectedId === b.id}
                    onClick={() => onSelect(b.id)}
                  />
                ))}
              </>
            ) : null}
          </div>
        ) : layout === 'board' ? (
          <div className="board">
            {cols.map((state) => (
              <section className="column" aria-label={COL_LABEL[state]} key={state}>
                <header className="column__head">
                  <span className="column__title">{COL_LABEL[state]}</span>
                  <span className="column__count">{grouped[state].length}</span>
                  {state === 'unassigned' ? (
                    <button
                      type="button"
                      className="column__add"
                      title="Create booking"
                      onClick={() => setNewOpen(true)}
                    >
                      <Icon.Plus />
                    </button>
                  ) : null}
                </header>
                <div className="column__body">
                  {grouped[state].length === 0 ? (
                    <div className="column__empty">No tickets.</div>
                  ) : (
                    grouped[state].map((b) => (
                      <BoardCard
                        key={b.id}
                        booking={b}
                        operator={
                          b.assignedOperatorId ? operatorById.get(b.assignedOperatorId) : undefined
                        }
                        driver={b.assignedDriverId ? driverById.get(b.assignedDriverId) : undefined}
                        selected={selectedId === b.id}
                        onClick={() => onSelect(b.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="list">
            <div className="list__row head">
              <span />
              <span>Pickup</span>
              <span>Customer</span>
              <span>Route</span>
              <span>Driver</span>
              <span>Status</span>
              <span>Assignee</span>
              <span style={{ textAlign: 'right' }}>Price</span>
            </div>
            {listVisible.map((b) => (
              <ListRow
                key={b.id}
                booking={b}
                driver={b.assignedDriverId ? driverById.get(b.assignedDriverId) : undefined}
                assignee={b.assignedOperatorId ? operatorById.get(b.assignedOperatorId) : undefined}
                selected={selectedId === b.id}
                onClick={() => onSelect(b.id)}
              />
            ))}
            {listVisible.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-4)' }}>
                No bookings match this view.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <DetailPanel
        booking={selected}
        drivers={drivers}
        operators={operators}
        me={me}
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        onDispatch={() => setDispatchOpen(true)}
        onBackfill={() => setBackfillOpen(true)}
        onCompleteOnBehalf={() => setCompleteFormOpen(true)}
        onEdit={() => setEditOpen(true)}
        onCancel={() => setCancelOpen(true)}
        onMutated={(toast) => handleMutated(toast, toast.startsWith('Trip approved'))}
      />

      <DispatchModal
        booking={selected}
        drivers={drivers}
        assignments={assignments}
        isOpen={dispatchOpen}
        onClose={() => setDispatchOpen(false)}
        onSent={(summary) => {
          setDispatchOpen(false);
          handleMutated(summary);
        }}
      />

      <BackfillModal
        booking={selected}
        isOpen={backfillOpen}
        onClose={() => setBackfillOpen(false)}
        onHandedOff={(summary) => {
          setBackfillOpen(false);
          handleMutated(summary);
        }}
      />

      <CompleteFormModal
        booking={selected}
        isOpen={completeFormOpen}
        onClose={() => setCompleteFormOpen(false)}
        onCompleted={(summary) => {
          setCompleteFormOpen(false);
          handleMutated(summary, true);
        }}
      />

      <CancelModal
        booking={selected}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onCancelled={(id) => {
          setCancelOpen(false);
          handleMutated(`${id.slice(0, 8)} cancelled.`, true);
        }}
      />

      <EditBookingModal
        booking={selected}
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(changed) => {
          setEditOpen(false);
          handleMutated(
            changed.length === 0
              ? 'No changes to save.'
              : `Booking updated — ${changed.length} field${changed.length === 1 ? '' : 's'} changed.`,
          );
        }}
      />

      <NewBookingModal
        isOpen={newOpen}
        meName={me.name}
        onClose={() => setNewOpen(false)}
        onCreated={handleCreated}
      />

      <div className="toast-stack">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            <Icon.Check /> {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

function ListRow({
  booking: b,
  driver,
  assignee,
  selected,
  onClick,
}: {
  booking: ConsoleBooking;
  driver: ConsoleDriver | undefined;
  assignee: ConsoleOperator | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`list__row ${selected ? 'is-selected' : ''}`}
      onClick={onClick}
    >
      <span>
        {b.flaggedAt ? (
          <Icon.Flag style={{ color: 'var(--prio-high)', width: 12, height: 12 }} />
        ) : (
          <span style={{ width: 12, display: 'inline-block' }} />
        )}
      </span>
      <span className="time">{fmtTimeWithDay(b.pickupAt)}</span>
      <span className="pax">
        {b.accountCode}
        <div className="pax__sub">
          {passengerName(b)}
          {b.caseCode ? ` · ${b.caseCode}` : ''}
        </div>
      </span>
      <span className="route">
        {truncate(b.pickupAddress, 28)} → {truncate(b.dropoffAddress, 28)}
      </span>
      <span className="driver-cell">
        {b.isBackfill ? (
          <>
            <Lozenge tone="purple">BACKFILL</Lozenge>
            <span style={{ marginLeft: 6 }}>{b.backfillDriverName ?? 'Backfill driver'}</span>
          </>
        ) : driver ? (
          <>
            <Avatar name={driver.name} id={driver.id} size={20} />
            {driver.name}
          </>
        ) : (
          <span style={{ color: 'var(--ink-4)' }}>—</span>
        )}
      </span>
      <span>
        <StateLozenge state={b.state} />
        {b.completionByOperator ? (
          <span title="Completed by the operator on the driver's behalf" style={{ marginLeft: 6 }}>
            <Lozenge tone="blue">OP-ENTERED</Lozenge>
          </span>
        ) : null}
      </span>
      <span>
        {assignee ? (
          <Avatar name={assignee.name} id={assignee.id} size={22} title={assignee.name} />
        ) : (
          <UnassignedAvatar size={22} />
        )}
      </span>
      <span className="price-cell">{fmtPrice(b.contractPricePence)}</span>
    </button>
  );
}

function BoardCard({
  booking,
  operator,
  driver,
  selected,
  onClick,
}: {
  booking: ConsoleBooking;
  operator: ConsoleOperator | undefined;
  driver: ConsoleDriver | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`card ${selected ? 'is-selected' : ''} ${booking.flaggedAt ? 'is-flagged' : ''}`}
      onClick={onClick}
    >
      <div className="card__head">
        <span className="card__id mono">{bookingRef(booking.seq)}</span>
        {booking.flaggedAt ? (
          <Icon.Flag
            style={{ color: 'var(--prio-high)', flex: '0 0 auto', width: 11, height: 11 }}
          />
        ) : null}
        <span className="card__time">{fmtTime(booking.pickupAt)}</span>
      </div>
      <div className="card__title">{booking.accountCode}</div>
      <div className="card__sub">{passengerName(booking)}</div>
      <div className="card__route">
        <span className="pin" />
        <span className="addr">{truncate(booking.pickupAddress, 44)}</span>
        <span className="pin to" />
        <span className="addr">{truncate(booking.dropoffAddress, 44)}</span>
      </div>
      <div className="card__meta">
        {booking.isBackfill ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Lozenge tone="purple">BACKFILL</Lozenge>
            <Tag>{booking.backfillDriverName ?? 'Backfill driver'}</Tag>
          </span>
        ) : driver ? (
          <Tag>{driver.name}</Tag>
        ) : booking.openOffers.length > 0 ? (
          <span
            className="tag tag--offered"
            title={booking.openOffers.map((o) => o.driverName).join(', ')}
          >
            <Icon.Send style={{ width: 10, height: 10 }} /> Offered to {booking.openOffers.length} ·
            awaiting
          </span>
        ) : (
          <span className="tag">No driver yet</span>
        )}
        {booking.completionByOperator ? (
          <span title="Completed by the operator on the driver's behalf" style={{ marginLeft: 6 }}>
            <Lozenge tone="blue">OP-ENTERED</Lozenge>
          </span>
        ) : null}
        <span className="card__meta-right">
          {operator ? (
            <Avatar
              name={operator.name}
              id={operator.id}
              size={20}
              title={`Assigned to ${operator.name}`}
            />
          ) : (
            <UnassignedAvatar size={20} />
          )}
        </span>
      </div>
    </button>
  );
}
