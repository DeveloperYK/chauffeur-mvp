'use client';

import { cancelBookingAction } from '@/app/(dashboard)/dashboard/console-actions';
import { useEffect, useState, useTransition } from 'react';
import { passengerName } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface CancelModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelled: (bookingId: string) => void;
}

export function CancelModal({ booking, isOpen, onClose, onCancelled }: CancelModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when the modal opens or the target booking changes
  useEffect(() => {
    if (isOpen) {
      setReason('');
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking) return null;

  const valid = reason.trim().length >= 5;
  const confirm = () => {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelBookingAction(booking.id, reason.trim());
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
              <div className="modal__title">Cancel booking</div>
              <div className="modal__sub">
                {passengerName(booking)} · <span className="mono">{booking.id.slice(0, 8)}</span>
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
            {/* biome-ignore lint/a11y/noLabelWithoutControl: textarea is the control inside .ctrl */}
            <label>
              Reason for cancellation<span className="req">*</span>
            </label>
            <div className="ctrl">
              <textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. PA called to cancel — meeting rescheduled to next Tuesday."
                // biome-ignore lint/a11y/noAutofocus: focus the only field on open
                autoFocus
              />
              <div className="hint">
                Min. 5 chars. Visible in the audit log and on the Sheets mirror.
              </div>
            </div>
          </div>
        </div>
        <footer className="modal__foot">
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Keep booking
          </button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={!valid || isPending}
            onClick={confirm}
          >
            {isPending ? 'Cancelling…' : 'Cancel booking'}
          </button>
        </footer>
      </div>
    </div>
  );
}
