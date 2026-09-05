'use client';

import { cancelBookingAction } from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { useEffect, useState, useTransition } from 'react';
import { fmtTimeWithDay, passengerName } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface CancelModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelled: (bookingId: string) => void;
}

/**
 * One-step cancel: no reason to type. The booking is removed from the backup
 * sheet, and the board's toast offers Undo for a minute in case it was the
 * wrong ticket.
 */
export function CancelModal({ booking, isOpen, onClose, onCancelled }: CancelModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the modal opens or the target booking changes
  useEffect(() => {
    if (isOpen) setError(null);
  }, [isOpen, booking?.id]);

  if (!booking) return null;

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelBookingAction(booking.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not cancel the booking.');
        return;
      }
      onCancelled(booking.id);
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
              <div className="modal__title">Cancel this booking?</div>
              <div className="modal__sub">
                {passengerName(booking)} · {fmtTimeWithDay(booking.pickupAt)} ·{' '}
                <span className="mono">{bookingRef(booking.seq)}</span>
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
          <p className="cancel-note">
            The booking is marked cancelled and removed from the backup sheet. You can undo this for
            60 seconds from the message that follows.
          </p>
        </div>
        <footer className="modal__foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Keep booking
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={isPending}
            onClick={confirm}
            // biome-ignore lint/a11y/noAutofocus: the destructive action is the only control worth focusing
            autoFocus
          >
            {isPending ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </footer>
      </div>
    </div>
  );
}
