'use client';

import {
  type ExecMessageEntry,
  type HistoryEntry,
  approveBookingAction,
  assignBookingOperatorAction,
  bookingHistoryAction,
  confirmChangeOnBehalfAction,
  execNotificationsAction,
  generateChangeConfirmLinkAction,
  generateCompletionLinkAction,
  rejectBookingAction,
  releaseDriverAction,
  resendExecNotificationAction,
  updateBackfillPayAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { VEHICLE_CLASS_LABEL, carDescription } from '@/lib/labels';
import { whatsappWebLink } from '@/lib/whatsapp';
import { useEffect, useState, useTransition } from 'react';
import { Avatar, UnassignedAvatar } from './avatar';
import { type CompletionLink, CompletionLinkModal } from './completion-link-modal';
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
  onBackfill: () => void;
  onCompleteOnBehalf: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onMutated: (toast: string) => void;
}

export function DetailPanel({
  booking,
  drivers,
  operators,
  me,
  isOpen,
  onClose,
  onDispatch,
  onBackfill,
  onCompleteOnBehalf,
  onEdit,
  onCancel,
  onMutated,
}: DetailPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [completionLink, setCompletionLink] = useState<CompletionLink | null>(null);
  const [changeLink, setChangeLink] = useState<CompletionLink | null>(null);
  const [editingPay, setEditingPay] = useState(false);
  const [payDraft, setPayDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showExec, setShowExec] = useState(false);
  const [execMessages, setExecMessages] = useState<ExecMessageEntry[] | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset panel UI state only when it opens or the booking changes
  useEffect(() => {
    if (isOpen) {
      setShowHistory(false);
      setHistory(null);
      setShowExec(false);
      setExecMessages(null);
      setCompletionLink(null);
      setChangeLink(null);
      setEditingPay(false);
      setPayDraft('');
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
  // Whoever is driving this job, internal or backfill — so the post-assignment
  // actions (call / message) are identical regardless. Backfill jobs have no
  // Driver row, just the operator-entered name + phone on the booking.
  const contact: { name: string; phone: string } | null = driver
    ? { name: driver.name, phone: driver.whatsappNumber }
    : booking.isBackfill && booking.backfillDriverName && booking.backfillDriverPhone
      ? { name: booking.backfillDriverName, phone: booking.backfillDriverPhone }
      : null;
  const assignee = booking.assignedOperatorId
    ? operators.find((o) => o.id === booking.assignedOperatorId)
    : null;
  const isAssignedToMe = booking.assignedOperatorId === me.id;
  const vehicle = booking.isBackfill
    ? booking.backfillCar
    : driver
      ? carDescription(driver.car, driver.carColour)
      : null;
  const hasNotes = !!booking.notes && booking.notes.trim().length > 0;
  const hasOperatorNotes = !!booking.operatorNotes && booking.operatorNotes.trim().length > 0;
  const hasCompletion =
    booking.dropoffAt != null || booking.carParkPence != null || booking.waitingTimeMinutes != null;

  // Headline price is the all-in total once the driver's completion data lands:
  // agreed fare + car park + waiting charge (matches the invoicing line total).
  const carParkPence = booking.carParkPence ?? 0;
  const waitingChargePence = booking.waitingFee.customerFeePence;
  const priceExtrasPence = carParkPence + waitingChargePence;
  const totalPricePence = booking.contractPricePence + priceExtrasPence;

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

  const loadExecMessages = () => {
    setExecLoading(true);
    execNotificationsAction(booking.id)
      .then((rows) => setExecMessages(rows))
      .finally(() => setExecLoading(false));
  };
  const toggleExec = () => {
    const next = !showExec;
    setShowExec(next);
    if (next && execMessages === null && !execLoading) loadExecMessages();
  };
  const resendExec = (id: string) => {
    setError(null);
    startTransition(async () => {
      const result = await resendExecNotificationAction(id);
      if (!result.ok) {
        setError(result.error ?? 'Could not resend the message.');
        return;
      }
      // Reload the drawer (new row + superseded old) and refresh the board so
      // the tile indicator clears.
      loadExecMessages();
      onMutated('Message re-sent to the exec.');
    });
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
  const startEditPay = () => {
    setPayDraft(
      booking.backfillDriverPayPence != null ? String(booking.backfillDriverPayPence / 100) : '',
    );
    setError(null);
    setEditingPay(true);
  };
  const savePay = () => {
    const pounds = Number.parseFloat(payDraft);
    if (!Number.isFinite(pounds) || pounds <= 0) {
      setError('Enter a valid driver pay (more than £0).');
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await updateBackfillPayAction(booking.id, Math.round(pounds * 100));
      if (!result.ok) {
        setError(result.error ?? 'Could not update the driver pay.');
        return;
      }
      setEditingPay(false);
      onMutated('Backfill driver pay updated.');
    });
  };
  const approve = () => run(() => approveBookingAction(booking.id), 'Trip approved & completed.');
  const reject = () =>
    run(() => rejectBookingAction(booking.id), 'Form rejected — driver to resubmit.');
  const releaseDriver = () =>
    run(
      () => releaseDriverAction(booking.id),
      'Driver released — booking back in the queue to reassign.',
    );
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
  const confirmChangeByPhone = () =>
    run(
      () => confirmChangeOnBehalfAction(booking.id),
      'Change confirmed — driver attested by phone.',
    );
  const sendChangeLink = () => {
    setError(null);
    startTransition(async () => {
      const result = await generateChangeConfirmLinkAction(booking.id);
      if (!result.ok || !result.url || !result.whatsappUrl) {
        setError(result.error ?? 'Could not generate the change link.');
        return;
      }
      setChangeLink({ url: result.url, whatsappUrl: result.whatsappUrl });
    });
  };

  // Mid-flight change confirmation banner — only on a dispatched booking that
  // has an outstanding (or just-confirmed) driver-facing change. Advisory: the
  // new details are already live; this only tracks whether the driver knows.
  const renderChangeConfirm = () => {
    const isDispatched = booking.state === 'assigned' || booking.state === 'in_progress';
    if (!isDispatched) return null;
    if (booking.changeConfirmationStatus === 'pending') {
      return (
        <div className="dp-change dp-change--pending">
          <div className="dp-change__head">
            <Lozenge tone="red">
              <Icon.Flag style={{ width: 10, height: 10, marginRight: 4 }} />
              CHANGE — DRIVER NOT CONFIRMED
            </Lozenge>
          </div>
          <p className="dp-change__note">
            Booking details changed after dispatch. Confirm the driver knows the new plan.
          </p>
          <div className="dp-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={confirmChangeByPhone}
              disabled={isPending}
            >
              <Icon.Phone /> Driver confirmed by phone
            </button>
            {booking.assignedDriverId ? (
              <button type="button" className="btn" onClick={sendChangeLink} disabled={isPending}>
                <Icon.Send /> Send change link
              </button>
            ) : null}
          </div>
        </div>
      );
    }
    if (booking.changeConfirmationStatus === 'confirmed') {
      const how = booking.changeConfirmedMethod === 'operator_attested' ? 'by phone' : 'by driver';
      return (
        <div className="dp-change dp-change--ok">
          <Lozenge tone="green">
            <Icon.Check style={{ width: 10, height: 10, marginRight: 4 }} />
            CHANGE CONFIRMED {how.toUpperCase()}
          </Lozenge>
          {booking.changeConfirmedAt ? (
            <span className="dp-change__when">{relTime(booking.changeConfirmedAt)}</span>
          ) : null}
        </div>
      );
    }
    return null;
  };
  // Contextual actions per state. Only offers what the backend can actually do.
  const renderActions = () => {
    switch (booking.state) {
      case 'unassigned':
        return (
          <>
            {booking.openOffers.length > 0 ? (
              <div
                className="dp-offered"
                title={booking.openOffers.map((o) => o.driverName).join(', ')}
              >
                <Icon.Send style={{ width: 13, height: 13 }} />
                <span>
                  Offered to <strong>{booking.openOffers.length}</strong> driver
                  {booking.openOffers.length === 1 ? '' : 's'} · awaiting a reply
                </span>
                <span className="dp-offered__names">
                  {booking.openOffers
                    .map((o) => o.driverName.split(' ')[0])
                    .slice(0, 4)
                    .join(', ')}
                  {booking.openOffers.length > 4 ? '…' : ''}
                </span>
              </div>
            ) : null}
            <div className="dp-actions">
              <button type="button" className="btn btn--primary btn--lg" onClick={onDispatch}>
                <Icon.Search />{' '}
                {booking.openOffers.length > 0 ? 'Offer to more drivers' : 'Find a driver'}
              </button>
              <button type="button" className="btn" onClick={onBackfill}>
                <Icon.Person /> Hand to backfill
              </button>
              <button type="button" className="btn" onClick={onEdit}>
                <Icon.Pencil /> Edit
              </button>
              <button type="button" className="btn btn--danger" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        );
      case 'assigned':
        return (
          <div className="dp-actions">
            {contact ? (
              <a
                className="btn btn--primary btn--lg"
                href={whatsappWebLink(
                  contact.phone,
                  `Hi ${contact.name.split(' ')[0]}, about the ${passengerName(booking)} job…`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Message driver on WhatsApp
              </a>
            ) : null}
            <button type="button" className="btn" onClick={releaseDriver} disabled={isPending}>
              <Icon.Reset /> Driver pulled out — unassign
            </button>
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
            {contact ? (
              <a className="btn btn--primary btn--lg" href={`tel:${contact.phone}`}>
                <Icon.Phone /> Call driver
              </a>
            ) : null}
            {contact ? (
              <a
                className="btn"
                href={whatsappWebLink(contact.phone, `Hi ${contact.name.split(' ')[0]}…`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Message driver
              </a>
            ) : null}
            <a
              className="btn"
              href={`sms:${booking.execMobile}?body=${encodeURIComponent(
                `Hi, an update on your ${passengerName(booking)} booking…`,
              )}`}
            >
              <Icon.Send /> Message passenger (SMS)
            </a>
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
              <Icon.Send /> {isPending ? 'Generating…' : 'Generate completion link'}
            </button>
            {contact ? (
              <a
                className="btn"
                href={whatsappWebLink(
                  contact.phone,
                  `Hi ${contact.name.split(' ')[0]}, please complete the form for ${passengerName(booking)}.`,
                )}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> WhatsApp driver
              </a>
            ) : null}
            <button type="button" className="btn" onClick={onCompleteOnBehalf}>
              <Icon.Check /> Enter completion details
            </button>
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
            <span className="mono">{bookingRef(booking.seq)}</span>
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
              {booking.isBackfill ? <Lozenge tone="purple">BACKFILL</Lozenge> : null}
              {booking.flaggedAt ? (
                <Lozenge tone="red">
                  <Icon.Flag style={{ width: 10, height: 10, marginRight: 4 }} />
                  24H NO ACCEPT
                </Lozenge>
              ) : null}
              <ExecHealthLozenge status={booking.execNotificationStatus} onClick={toggleExec} />
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
                <div className="dp-stat__val tabnum">{fmtPrice(totalPricePence)}</div>
                {priceExtrasPence > 0 ? (
                  <div className="dp-stat__sub">
                    Fare {fmtPrice(booking.contractPricePence)}
                    {carParkPence > 0 ? ` + parking ${fmtPrice(carParkPence)}` : ''}
                    {waitingChargePence > 0 ? ` + waiting ${fmtPrice(waitingChargePence)}` : ''}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {error ? (
            <div className="ic ic--danger">
              <div className="ic__body">{error}</div>
            </div>
          ) : null}

          {/* MID-FLIGHT CHANGE CONFIRMATION */}
          {renderChangeConfirm()}

          {/* PRIMARY ACTIONS */}
          {renderActions()}

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
                  {booking.isBackfill ? (
                    <div className="ir__row">
                      <Avatar
                        name={booking.backfillDriverName ?? 'Backfill'}
                        id={booking.id}
                        size={22}
                      />
                      <span>{booking.backfillDriverName ?? 'Backfill driver'}</span>
                      <Lozenge tone="purple">BACKFILL</Lozenge>
                      {booking.backfillDriverPhone ? (
                        <span className="ir__sub mono" style={{ marginLeft: 4 }}>
                          {booking.backfillDriverPhone}
                        </span>
                      ) : null}
                    </div>
                  ) : driver ? (
                    <div className="ir__row">
                      <Avatar name={driver.name} id={driver.id} size={22} />
                      <span>{driver.name}</span>
                      <span className={`vc-tag ${driver.vehicleClass}`}>
                        {VEHICLE_CLASS_LABEL[driver.vehicleClass]}
                      </span>
                      <span className="ir__sub mono" style={{ marginLeft: 4 }}>
                        {driver.whatsappNumber}
                      </span>
                    </div>
                  ) : (
                    <span className="muted">Not yet assigned</span>
                  )}
                </div>
              </div>
              {booking.isBackfill ? (
                <div className="ir">
                  <div className="ir__k">Backfill pay</div>
                  <div className="ir__v">
                    {editingPay ? (
                      <div className="ir__row">
                        <div className="money" style={{ maxWidth: 140 }}>
                          <div className="pfx">£</div>
                          <input
                            type="number"
                            step="1"
                            min={0}
                            value={payDraft}
                            onChange={(e) => setPayDraft(e.target.value)}
                            // biome-ignore lint/a11y/noAutofocus: focus the field when the inline editor opens
                            autoFocus
                          />
                        </div>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={savePay}
                          disabled={isPending}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="link-btn"
                          onClick={() => setEditingPay(false)}
                          disabled={isPending}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="ir__row">
                        <span>
                          {booking.backfillDriverPayPence != null
                            ? fmtPrice(booking.backfillDriverPayPence)
                            : '—'}
                        </span>
                        <button type="button" className="link-btn" onClick={startEditPay}>
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {/* NOTES — driver-facing */}
          {hasNotes ? (
            <section className="ic">
              <header className="ic__head">
                <span>Notes for the driver</span>
              </header>
              <div className="ic__body ic__body--prose">{booking.notes}</div>
            </section>
          ) : null}

          {/* PRIVATE NOTES — operators only, never shown to the driver */}
          {hasOperatorNotes ? (
            <section className="ic">
              <header className="ic__head">
                <span>🔒 Private notes — operators only</span>
              </header>
              <div className="ic__body ic__body--prose">{booking.operatorNotes}</div>
            </section>
          ) : null}

          {/* COMPLETION FORM */}
          {hasCompletion ? (
            <section className="ic">
              <header className="ic__head">
                <span>
                  {booking.completionByOperator ? 'Completion form' : 'Driver completion form'}
                </span>
              </header>
              <div className="ic__body">
                {booking.completionByOperator ? (
                  <div className="ir">
                    <div className="ir__k">Source</div>
                    <div className="ir__v">Entered by the operator on the driver&apos;s behalf</div>
                  </div>
                ) : null}
                <div className="ir">
                  <div className="ir__k">Arrival</div>
                  <div className="ir__v">
                    {booking.arrivalAt ? fmtTimeWithDay(booking.arrivalAt) : '—'}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Passenger on board</div>
                  <div className="ir__v">
                    {booking.passengerOnBoardAt ? fmtTimeWithDay(booking.passengerOnBoardAt) : '—'}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Parking fee</div>
                  <div className="ir__v">
                    {booking.carParkPence && booking.carParkPence > 0 ? (
                      fmtPrice(booking.carParkPence)
                    ) : (
                      <span className="muted">No parking fee</span>
                    )}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Waiting time</div>
                  <div className="ir__v">{booking.waitingTimeMinutes ?? 0} min</div>
                </div>
                <div className="ir">
                  <div className="ir__k">Waiting charge</div>
                  <div className="ir__v">
                    {booking.waitingFee.customerFeePence > 0 ? (
                      <>
                        {fmtPrice(booking.waitingFee.customerFeePence)}{' '}
                        <span className="muted">
                          ({booking.waitingFee.chargeableMinutes} chargeable min · driver gets{' '}
                          {fmtPrice(booking.waitingFee.driverPayPence)})
                        </span>
                      </>
                    ) : (
                      <span className="muted">None — within free period</span>
                    )}
                  </div>
                </div>
                <div className="ir">
                  <div className="ir__k">Completion time</div>
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

          {/* EXEC MESSAGES */}
          <section className="ic ic--activity">
            <button
              type="button"
              className="ic__head ic__head--toggle"
              onClick={toggleExec}
              aria-expanded={showExec}
            >
              <span>Exec messages</span>
              <span className="ic__head-meta">
                {execStatusMeta(booking.execNotificationStatus)}
                <Icon.ChevDown
                  style={{
                    width: 12,
                    height: 12,
                    marginLeft: 6,
                    transform: showExec ? 'rotate(180deg)' : 'none',
                    transition: 'transform 120ms ease',
                  }}
                />
              </span>
            </button>
            {showExec ? (
              <div className="ic__body">
                {execLoading ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Loading…
                  </div>
                ) : execMessages && execMessages.length > 0 ? (
                  <div className="timeline">
                    {execMessages.map((m) => {
                      const isFailure =
                        m.status === 'failed' ||
                        m.status === 'bounced' ||
                        m.status === 'complained';
                      return (
                        <div className="timeline__item" key={m.id}>
                          <span className={`timeline__dot ${isFailure ? '' : 'muted'}`} />
                          <div className="timeline__body">
                            <div className="ts">
                              {fmtTimeWithDay(m.createdAt)} · {relTime(m.createdAt)}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span className="who">{EXEC_KIND_LABEL[m.kind]}</span>
                              <span className="muted" style={{ fontSize: 11 }}>
                                {EXEC_CHANNEL_LABEL[m.channel]}
                              </span>
                              <ExecStatusLozenge status={m.status} channel={m.channel} />
                            </div>
                            <div
                              className="muted"
                              style={{ fontSize: 12, whiteSpace: 'pre-line', marginTop: 4 }}
                            >
                              {m.body}
                            </div>
                            {m.errorReason ? (
                              <div
                                style={{
                                  fontSize: 12,
                                  color: 'var(--prio-high)',
                                  marginTop: 2,
                                }}
                              >
                                Error: {m.errorReason}
                              </div>
                            ) : null}
                            {isFailure ? (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => resendExec(m.id)}
                                style={{
                                  marginTop: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: 'var(--prio-high)',
                                  background: 'none',
                                  border: '1px solid currentColor',
                                  borderRadius: 6,
                                  padding: '2px 10px',
                                  cursor: isPending ? 'default' : 'pointer',
                                }}
                              >
                                {isPending ? 'Resending…' : 'Resend'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    No messages sent to the exec yet.
                  </div>
                )}
              </div>
            ) : null}
          </section>

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

      {/* Rendered outside the transformed .panel so its fixed positioning is
          relative to the viewport, not the slide-over. */}
      <CompletionLinkModal
        booking={booking}
        driverName={contact?.name ?? null}
        link={completionLink}
        onClose={() => setCompletionLink(null)}
      />
      <CompletionLinkModal
        booking={booking}
        driverName={contact?.name ?? null}
        link={changeLink}
        onClose={() => setChangeLink(null)}
        title="Change confirmation link"
      />
    </>
  );
}

const EXEC_KIND_LABEL: Record<ExecMessageEntry['kind'], string> = {
  assigned: 'Booking confirmed',
  en_route: 'Driver en route',
};

const EXEC_CHANNEL_LABEL: Record<ExecMessageEntry['channel'], string> = {
  sms: 'SMS',
  email: 'Email',
};

/** One-line summary shown in the collapsed "Exec messages" section header. */
function execStatusMeta(status: ConsoleBooking['execNotificationStatus']): string {
  switch (status) {
    case 'failed':
      return '⚠ a message failed';
    case 'pending':
      return 'email pending';
    case 'ok':
      return 'all delivered';
    default:
      return 'none yet';
  }
}

/** Clickable health pill in the panel hero; opens the exec-messages drawer. */
function ExecHealthLozenge({
  status,
  onClick,
}: {
  status: ConsoleBooking['execNotificationStatus'];
  onClick: () => void;
}) {
  if (status === 'none') return null;
  const cfg =
    status === 'failed'
      ? { tone: 'red' as const, label: 'EXEC MESSAGE FAILED' }
      : status === 'pending'
        ? { tone: 'orange' as const, label: 'EXEC EMAIL PENDING' }
        : { tone: 'green' as const, label: 'EXEC NOTIFIED' };
  return (
    <button
      type="button"
      onClick={onClick}
      title="View exec messages"
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
    >
      <Lozenge tone={cfg.tone}>{cfg.label}</Lozenge>
    </button>
  );
}

/** Per-message status pill in the drawer. */
function ExecStatusLozenge({
  status,
  channel,
}: {
  status: ExecMessageEntry['status'];
  channel: ExecMessageEntry['channel'];
}) {
  const cfg = ((): { tone: 'gray' | 'green' | 'orange' | 'red'; label: string } => {
    switch (status) {
      case 'sent':
        return channel === 'email'
          ? { tone: 'orange', label: 'PENDING' }
          : { tone: 'green', label: 'SENT' };
      case 'delivered':
        return { tone: 'green', label: 'DELIVERED' };
      case 'failed':
        return { tone: 'red', label: 'FAILED' };
      case 'bounced':
        return { tone: 'red', label: 'BOUNCED' };
      case 'complained':
        return { tone: 'red', label: 'SPAM' };
      case 'superseded':
        return { tone: 'gray', label: 'SUPERSEDED' };
    }
  })();
  return <Lozenge tone={cfg.tone}>{cfg.label}</Lozenge>;
}
