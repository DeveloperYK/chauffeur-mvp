'use client';

import { completeFormOnBehalfAction } from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { useEffect, useState, useTransition } from 'react';
import { passengerName, toLocalTimeInput } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface CompleteFormModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onCompleted: (summary: string) => void;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sensible default times: arrival/on-board at pickup, completion at pickup + duration. */
function defaultTimes(booking: ConsoleBooking): { atPickup: string; atCompletion: string } {
  const pickupMs = new Date(booking.pickupAt).getTime();
  const completionMs = pickupMs + booking.expectedDurationMinutes * 60_000;
  return {
    atPickup: toLocalTimeInput(new Date(pickupMs).toISOString()),
    atCompletion: toLocalTimeInput(new Date(completionMs).toISOString()),
  };
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
  const [arrivalTime, setArrivalTime] = useState('');
  const [passengerOnBoardTime, setPassengerOnBoardTime] = useState('');
  const [completionTime, setCompletionTime] = useState('');
  const [carParkPounds, setCarParkPounds] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when the modal opens or the target booking changes
  useEffect(() => {
    if (isOpen && booking) {
      const { atPickup, atCompletion } = defaultTimes(booking);
      setArrivalTime(atPickup);
      setPassengerOnBoardTime(atPickup);
      setCompletionTime(atCompletion);
      setCarParkPounds('0');
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking) return null;

  const carParkPence = Math.round(Number.parseFloat(carParkPounds || '0') * 100);
  const valid =
    HHMM.test(arrivalTime) &&
    HHMM.test(passengerOnBoardTime) &&
    HHMM.test(completionTime) &&
    Number.isFinite(carParkPence) &&
    carParkPence >= 0;

  const submit = () => {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await completeFormOnBehalfAction(booking.id, {
        arrivalTime,
        passengerOnBoardTime,
        completionTime,
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
              Arrival time<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                type="time"
                value={arrivalTime}
                onChange={(e) => setArrivalTime(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Passenger on board time<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                type="time"
                value={passengerOnBoardTime}
                onChange={(e) => setPassengerOnBoardTime(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Completion time<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                type="time"
                value={completionTime}
                onChange={(e) => setCompletionTime(e.target.value)}
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>Parking fee (£)</label>
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
