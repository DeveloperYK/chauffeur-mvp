'use client';

import { handToBackfillAction } from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { useEffect, useState, useTransition } from 'react';
import { fmtTimeWithDay, passengerName } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface BackfillModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onHandedOff: (summary: string) => void;
}

/**
 * Hand an unassigned booking to a backfill (subcontractor) driver sourced from
 * the WhatsApp group. The operator records who is covering it — name, phone,
 * car — and the booking moves to Assigned, flagged as backfill. The exec gets
 * the usual assignment confirmation naming the backfill driver.
 */
export function BackfillModal({ booking, isOpen, onClose, onHandedOff }: BackfillModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [car, setCar] = useState('');
  const [pay, setPay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the form only when the modal opens or the target booking changes
  useEffect(() => {
    if (isOpen) {
      setName('');
      setPhone('');
      setCar('');
      setPay('');
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking) return null;

  const payPounds = Number.parseFloat(pay);
  const payValid = Number.isFinite(payPounds) && payPounds > 0;
  const valid =
    name.trim().length >= 2 && phone.trim().length >= 7 && car.trim().length >= 1 && payValid;

  const submit = () => {
    if (!valid) return;
    setError(null);
    startTransition(async () => {
      const result = await handToBackfillAction(booking.id, {
        name: name.trim(),
        phone: phone.trim(),
        car: car.trim(),
        payPence: Math.round(payPounds * 100),
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not hand the booking to a backfill driver.');
        return;
      }
      onHandedOff(`Handed to ${name.trim().split(' ')[0]} (backfill).`);
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
              <div className="modal__title">Hand to backfill driver</div>
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

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Driver name<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dave Smith"
                // biome-ignore lint/a11y/noAutofocus: focus the first field on open
                autoFocus
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Driver phone<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +44 7911 123456"
              />
              <div className="hint">Include the country code with a leading +.</div>
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Car<span className="req">*</span>
            </label>
            <div className="ctrl">
              <input
                value={car}
                onChange={(e) => setCar(e.target.value)}
                placeholder="e.g. BMW 5 Series"
              />
            </div>
          </div>

          <div className="field">
            {/* biome-ignore lint/a11y/noLabelWithoutControl: input is the control inside .ctrl */}
            <label>
              Driver pay<span className="req">*</span>
            </label>
            <div className="ctrl">
              <div className="money">
                <div className="pfx">£</div>
                <input
                  type="number"
                  step="1"
                  min={0}
                  value={pay}
                  onChange={(e) => setPay(e.target.value)}
                  placeholder="120"
                />
              </div>
              <div className="hint">What this backfill driver is paid for the job.</div>
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
            className="btn btn--primary"
            disabled={!valid || isPending}
            onClick={submit}
          >
            <Icon.Check /> {isPending ? 'Handing off…' : 'Hand to backfill'}
          </button>
        </footer>
      </div>
    </div>
  );
}
