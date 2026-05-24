'use client';

import {
  type HistoryEntry,
  approveBookingAction,
  assignBookingOperatorAction,
  bookingHistoryAction,
  generateCompletionLinkAction,
  rejectBookingAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { useEffect, useState, useTransition } from 'react';
import { Avatar, UnassignedAvatar } from './avatar';
import { fmtPrice, fmtTimeWithDay, passengerName, relTime } from './format';
import { Icon } from './icons';
import { Lozenge, StateLozenge, Tag } from './lozenge';
import type { ConsoleBooking, ConsoleDriver, ConsoleOperator } from './types';

interface DetailPanelProps {
  booking: ConsoleBooking | null;
  drivers: ConsoleDriver[];
  operators: ConsoleOperator[];
  me: { id: string; name: string };
  isOpen: boolean;
  onClose: () => void;
  onDispatch: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onMutated: (toast: string) => void;
}

function waLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

export function DetailPanel({
  booking,
  drivers,
  operators,
  me,
  isOpen,
  onClose,
  onDispatch,
  onEdit,
  onCancel,
  onMutated,
}: DetailPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [completionLink, setCompletionLink] = useState<{ url: string; whatsappUrl: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset panel UI state only when it opens or the booking changes
  useEffect(() => {
    if (isOpen) {
      setShowHistory(false);
      setHistory(null);
      setCompletionLink(null);
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking) {
    return (
      <>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
        <div className={`scrim ${isOpen ? 'is-open' : ''}`} onClick={onClose} />
        <aside className={`panel ${isOpen ? 'is-open' : ''}`} />
      </>
    );
  }

  const driver = booking.assignedDriverId
    ? drivers.find((d) => d.id === booking.assignedDriverId)
    : null;
  const assignee = booking.assignedOperatorId
    ? operators.find((o) => o.id === booking.assignedOperatorId)
    : null;
  const isAssignedToMe = booking.assignedOperatorId === me.id;
  const vehicle = booking.carForThisJob;
  const hasNotes = !!booking.notes && booking.notes.trim().length > 0;
  const hasCompletion =
    booking.dropoffAt != null || booking.carParkPence != null || booking.waitingTimeMinutes != null;

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history === null && !historyLoading) {
      setHistoryLoading(true);
      bookingHistoryAction(booking.id)
        .then((rows) => setHistory(rows))
        .finally(() => setHistoryLoading(false));
    }
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, toast: string) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? 'Action failed.');
        return;
      }
      onMutated(toast);
    });
  };

  const assignToMe = () =>
    run(
      () => assignBookingOperatorAction(booking.id, me.id),
      `Assigned to ${me.name.split(' ')[0]}.`,
    );
  const approve = () => run(() => approveBookingAction(booking.id), 'Trip approved & completed.');
  const reject = () =>
    run(() => rejectBookingAction(booking.id), 'Form rejected — driver to resubmit.');
  const generateCompletion = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateCompletionLinkAction(booking.id);
      if (!result.ok || !result.url || !result.whatsappUrl) {
        setError(result.error ?? 'Could not generate the completion link.');
        return;
      }
      setCompletionLink({ url: result.url, whatsappUrl: result.whatsappUrl });
    });
  };

  // Contextual actions per state. Only offers what the backend can actually do.
  const renderActions = () => {
    switch (booking.state) {
      case 'unassigned':
        return (
          <div className="dp-actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={onDispatch}>
              <Icon.Send /> Generate dispatch link
            </button>
            <button type="button" className="btn" onClick={onEdit}>
              <Icon.Pencil /> Edit
            </button>
            <button type="button" className="btn btn--danger" onClick={onCancel}>
              Cancel
            </button>
          </div>
        );
      case 'assigned':
        return (
          <div className="dp-actions">
            {driver ? (
              <a
                className="btn btn--primary btn--lg"
                href={waLink(
                  driver.whatsappNumber,
                  `Hi ${driver.name.split(' ')[0]}, about the ${passengerName(booking)} job…`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Message driver on WhatsApp
              </a>
            ) : null}
            <button type="button" className="btn" onClick={onEdit}>
              <Icon.Pencil /> Edit
            </button>
            <button type="button" className="btn btn--danger" onClick={onCancel}>
              Cancel
            </button>
          </div>
        );
      case 'in_progress':
        return (
          <div className="dp-actions">
            {driver ? (
              <a className="btn btn--primary btn--lg" href={`tel:${driver.whatsappNumber}`}>
                <Icon.Phone /> Call driver
              </a>
            ) : null}
            {driver ? (
              <a
                className="btn"
                href={waLink(driver.whatsappNumber, `Hi ${driver.name.split(' ')[0]}…`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Message
              </a>
            ) : null}
          </div>
        );
      case 'awaiting_driver_form':
        return (
          <div className="dp-actions">
            <button
              type="button"
              className="btn btn--primary btn--lg"
              onClick={generateCompletion}
              disabled={isPending}
            >
              <Icon.Send /> {isPending ? 'Texting…' : 'Text completion link'}
            </button>
            {driver ? (
              <a
                className="btn"
                href={waLink(
                  driver.whatsappNumber,
                  `Hi ${driver.name.split(' ')[0]}, please complete the form for ${passengerName(booking)}.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Chase driver
              </a>
            ) : null}
          </div>
        );
      case 'awaiting_operator_review':
        return (
          <div className="dp-actions">
            <button
              type="button"
              className="btn btn--success btn--lg"
              onClick={approve}
              disabled={isPending}
            >
              <Icon.Check /> Approve &amp; complete
            </button>
            <button type="button" className="btn btn--danger" onClick={reject} disabled={isPending}>
              Reject — driver to resubmit
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className={`scrim ${isOpen ? 'is-open' : ''}`} onClick={onClose} />
      {/* biome-ignore lint/a11y/useSemanticElements: styled slide-over surface; native <dialog> conflicts with the design CSS */}
      <aside className={`panel ${isOpen ? 'is-open' : ''}`} role="dialog" aria-modal="true">
        <header className="panel__head">
          <span className="panel__crumb">
            <Icon.Board style={{ width: 13, height: 13 }} />
            <span>Board</span>
            <Icon.ChevRight style={{ width: 11, height: 11 }} />
            <span className="mono">{booking.id.slice(0, 8)}</span>
          </span>
          <span className="spacer" />
          <button type="button" className="icon-btn" title="Close (esc)" onClick={onClose}>
            <Icon.Close />
          </button>
        </header>

        <div className="panel__body">
          {/* HERO */}
          <div className="dp-hero">
            <div className="dp-hero__lozenges">
              <StateLozenge state={booking.state} lg />
              {booking.flaggedAt ? (
                <Lozenge tone="red">
                  <Icon.Flag style={{ width: 10, height: 10, marginRight: 4 }} />
                  24H NO ACCEPT
                </Lozenge>
              ) : null}
            </div>
            <div className="dp-hero__eyebrow">
              <Icon.Person style={{ width: 11, height: 11 }} /> Customer account
            </div>
            <h1 className="dp-hero__title">{booking.accountCode}</h1>
            <div className="dp-hero__sub">Passenger: {passengerName(booking)}</div>
            <div className="dp-hero__stats">
              <div className="dp-stat">
                <div className="dp-stat__lbl">Pickup</div>
                <div className="dp-stat__val">{fmtTimeWithDay(booking.pickupAt)}</div>
                <div className="dp-stat__sub">{relTime(booking.pickupAt)}</div>
              </div>
              <div className="dp-stat">
                <div className="dp-stat__lbl">Duration</div>
                <div className="dp-stat__val">{booking.expectedDurationMinutes} min</div>
              </div>
              <div className="dp-stat dp-stat--price">
                <div className="dp-stat__lbl">Price</div>
                <div className="dp-stat__val tabnum">{fmtPrice(booking.contractPricePence)}</div>
              </div>
            </div>
          </div>

          {error ? (
            <div className="ic ic--danger">
              <div className="ic__body">{error}</div>
            </div>
          ) : null}

          {/* PRIMARY ACTIONS */}
          {renderActions()}

          {/* Minted completion link — texted to the driver automatically */}
          {completionLink ? (
            <div className="dispatch-result" style={{ marginTop: 4 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                Completion link texted to the driver.
              </div>
              <div className="dispatch-result__url">
                <Icon.Link style={{ width: 14, height: 14 }} />
                <span>{completionLink.url}</span>
              </div>
              <a
                className="btn btn--block"
                style={{ marginTop: 10 }}
                href={completionLink.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Also message on WhatsApp (optional)
              </a>
            </div>
          ) : null}

          {/* TRIP */}
          <section className="ic">
            <header className="ic__head">
              <span>Trip</span>
            </header>
            <div className="ic__body">
              <div className="route">
                <div className="route__pins">
                  <span className="route__pin" />
                  <span className="route__line" />
                  <span className="route__pin route__pin--to" />
                </div>
                <div className="route__cells">
                  <div className="route__cell">
                    <div className="route__lbl">Pickup</div>
                    <div className="route__addr">{booking.pickupAddress}</div>
                  </div>
                  <div className="route__cell">
                    <div className="route__lbl">Drop-off</div>
                    <div className="route__addr">{booking.dropoffAddress}</div>
                  </div>
                </div>
              </div>
              {vehicle ? (
                <div className="trip-meta">
                  <Tag>{vehicle}</Tag>
                </div>
              ) : null}
            </div>
          </section>

          {/* PEOPLE */}
          <section className="ic">
            <header className="ic__head">
              <span>People</span>
            </header>
            <div className="ic__body">
              <div className="ir">
                <div className="ir__k">Customer account</div>
                <div className="ir__v">
                  <div className="ir__main">{booking.accountCode}</div>
                </div>
              </div>
              <div className="ir">
                <div className="ir__k">Case code</div>
                <div className="ir__v">
                  {booking.caseCode ? (
                    <span className="mono">{booking.caseCode}</span>
                  ) : (
                    <span className="muted">— not set</span>
                  )}
                </div>
              </div>
              <div className="ir">
                <div className="ir__k">Passenger</div>
                <div className="ir__v">
                  <div className="ir__main">{passengerName(booking)}</div>
                  <div className="ir__sub mono">{booking.execMobile}</div>
                </div>
              </div>
              <div className="ir">
                <div className="ir__k">Operator</div>
                <div className="ir__v">
                  <div className="ir__row">
                    {assignee ? (
                      <>
                        <Avatar name={assignee.name} id={assignee.id} size={22} />
                        <span>{assignee.name}</span>
                      </>
                    ) : (
                      <>
                        <UnassignedAvatar size={22} />
                        <span className="muted">Unassigned</span>
                      </>
                    )}
                    {!isAssignedToMe ? (
                      <button
                        type="button"
                        className="link-btn"
                        onClick={assignToMe}
                        disabled={isPending}
                      >
                        Assign to me
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="ir">
                <div className="ir__k">Driver</div>
                <div className="ir__v">
                  {driver ? (
                    <div className="ir__row">
                      <Avatar name={driver.name} id={driver.id} size={22} />
                      <span>{driver.name}</span>
                      <span className={`tier-tag ${driver.tier}`}>{driver.tier}</span>
                      <span className="ir__sub mono" style={{ marginLeft: 4 }}>
                        {driver.whatsappNumber}
                      </span>
                    </div>
                  ) : (
                    <span className="muted">Not yet assigned</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* NOTES */}
          {hasNotes ? (
            <section className="ic">
              <header className="ic__head">
                <span>Notes for the driver</span>
              </header>
              <div className="ic__body ic__body--prose">{booking.notes}</div>
            </section>
          ) : null}

          {/* COMPLETION FORM */}
          {hasCompletion ? (
            <section className="ic">
              <header className="ic__head">
                <span>Driver completion form</span>
              </header>
              <div className="ic__body">
                <div className="ir">
                  <div className="ir__k">Car park</div>
                  <div className="ir__v">
                    {booking.carParkPence && booking.carParkPence > 0 ? (
                      fmtPrice(booking.carParkPence)
                    ) : (
                      <span className="muted">No car park fee</span>
                    )}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Waiting time</div>
                  <div className="ir__v">{booking.waitingTimeMinutes ?? 0} min</div>
                </div>
                <div className="ir">
                  <div className="ir__k">Drop-off</div>
                  <div className="ir__v">
                    {booking.dropoffAt ? fmtTimeWithDay(booking.dropoffAt) : '—'}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {/* CANCELLATION */}
          {booking.state === 'cancelled' ? (
            <section className="ic ic--danger">
              <header className="ic__head">
                <span>Cancellation</span>
              </header>
              <div className="ic__body">
                <div className="ir">
                  <div className="ir__k">When</div>
                  <div className="ir__v">
                    {booking.cancelledAt ? fmtTimeWithDay(booking.cancelledAt) : '—'}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Reason</div>
                  <div className="ir__v">{booking.cancellationReason ?? '—'}</div>
                </div>
              </div>
            </section>
          ) : null}

          {/* HISTORY */}
          <section className="ic ic--activity">
            <button
              type="button"
              className="ic__head ic__head--toggle"
              onClick={toggleHistory}
              aria-expanded={showHistory}
            >
              <span>History</span>
              <span className="ic__head-meta">
                {history
                  ? `${history.length} ${history.length === 1 ? 'entry' : 'entries'}`
                  : 'audit trail'}
                <Icon.ChevDown
                  style={{
                    width: 12,
                    height: 12,
                    marginLeft: 6,
                    transform: showHistory ? 'rotate(180deg)' : 'none',
                    transition: 'transform 120ms ease',
                  }}
                />
              </span>
            </button>
            {showHistory ? (
              <div className="ic__body">
                {historyLoading ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Loading…
                  </div>
                ) : history && history.length > 0 ? (
                  <div className="timeline">
                    {history
                      .slice()
                      .reverse()
                      .map((t, i) => (
                        <div className="timeline__item" key={t.id}>
                          <span className={`timeline__dot ${i === 0 ? '' : 'muted'}`} />
                          <div className="timeline__body">
                            <div className="ts">
                              {fmtTimeWithDay(t.ts)} · {relTime(t.ts)}
                            </div>
                            <div>
                              <span className="who">{t.actor}</span> {t.text}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    No history yet.
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </>
  );
}
