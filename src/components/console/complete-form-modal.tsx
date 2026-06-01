'use client';

import { completeFormOnBehalfAction } from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { useEffect, useState, useTransition } from 'react';
import { passengerName, toLocalDateTimeInput } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface CompleteFormModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (summary: string) => void;
}

/** A sensible default drop-off: the booking's pickup plus its expected duration. */
function defaultDropoff(booking: ConsoleBooking): string {
  const end = new Date(booking.pickupAt).getTime() + booking.expectedDurationMinutes * 60_000;
  return toLocalDateTimeInput(new Date(end).toISOString());
}

/**
 * Operator fills the completion form on the driver's behalf — for when the
 * driver is slow/unreachable and the operator has the numbers from a call. Same
 * fields as the driver form; submitting completes the booking directly (skips
 * the operator-review stage).
 */
export function CompleteFormModal({
  booking,
  isOpen,
  onClose,
  onCompleted,
}: CompleteFormModalProps) {
  const [dropoffAt, setDropoffAt] = useState('');
  const [waiting, setWaiting] = useState('0');
  const [carParkPounds, setCarParkPounds] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when the modal opens or the target booking changes
  useEffect(() => {
    if (isOpen && booking) {
      setDropoffAt(defaultDropoff(booking));
      setWaiting('0');
      setCarParkPounds('0');
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking) return null;

  const waitingMinutes = Number.parseInt(waiting, 10);
  const carParkPence = Math.round(Number.parseFloat(carParkPounds || '0') * 100);
  const valid =
    dropoffAt.length > 0 &&
    Number.isFinite(waitingMinutes) &&
    waitingMinutes >= 0 &&
    Number.isFinite(carParkPence) &&
    carParkPence >= 0;

  const submit = () => {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await completeFormOnBehalfAction(booking.id, {
        dropoffAt: new Date(dropoffAt).toISOString(),
        waitingTimeMinutes: waitingMinutes,
        carParkPence,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not complete the booking.');
        return;
      }
      onCompleted('Completed on the driver’s behalf.');
    });
  };

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      {/* biome-ignore lint/a11y/useSemanticElements: styled dialog surface; native <dialog> conflicts with the design CSS */}
      <div className="modal__card" style={{ width: 480 }} role="dialog" aria-modal="true">
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">Enter completion details</div>
              <div className="modal__sub">
                {passengerName(booking)} · <span className="mono">{bookingRef(booking.seq)}</span>
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="icon-btn" onClick={onClose}>
              <Icon.Close />
            </button>
          </div>
        </header>
        <div className="modal__body">
          {error ? (
            <div className="ic ic--danger" style={{ marginBottom: 10 }}>
              <div className="ic__body">{error}</div>
            </div>
          ) : null}

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Drop-off time<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                type="datetime-local"
                value={dropoffAt}
                onChange={(e) => setDropoffAt(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>Waiting time (minutes)</label>
            <div className="ctrl">
              <input
                type="number"
                min={0}
                max={720}
                value={waiting}
                onChange={(e) => setWaiting(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>Car park (£)</label>
            <div className="ctrl">
              <input
                type="number"
                min={0}
                step="0.01"
                value={carParkPounds}
                onChange={(e) => setCarParkPounds(e.target.value)}
              />
            </div>
          </div>
        </div>
        <footer className="modal__foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--success"
            disabled={!valid || isPending}
            onClick={submit}
          >
            <Icon.Check /> {isPending ? 'Completing…' : 'Complete booking'}
          </button>
        </footer>
      </div>
    </div>
  );
}
