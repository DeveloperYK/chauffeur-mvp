'use client';

import { editBookingAction } from '@/app/(dashboard)/dashboard/console-actions';
import { useEffect, useState, useTransition } from 'react';
import { AddressAutocomplete } from './address-autocomplete';
import { toLocalDateTimeInput } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

interface EditBookingModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (changedFields: string[]) => void;
}

interface EditForm {
  pickupAt: string;
  expectedDurationMinutes: number;
  pickupAddress: string;
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string;
  execMobile: string;
  customerAccount: string;
  caseCode: string;
  contractPricePounds: string;
  notes: string;
}

const DURATIONS = [30, 45, 60, 90, 120, 180, 240, 360];
const DURATION_LABEL: Record<number, string> = {
  30: '30 min',
  45: '45 min',
  60: '1 h',
  90: '1 h 30',
  120: '2 h',
  180: '3 h',
  240: '4 h block',
  360: '6 h block',
};

export function EditBookingModal({ booking, isOpen, onClose, onSaved }: EditBookingModalProps) {
  const [form, setForm] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate the form only when the modal opens or the booking changes
  useEffect(() => {
    if (isOpen && booking) {
      setForm({
        pickupAt: toLocalDateTimeInput(booking.pickupAt),
        expectedDurationMinutes: booking.expectedDurationMinutes,
        pickupAddress: booking.pickupAddress,
        dropoffAddress: booking.dropoffAddress,
        passengerFirstName: booking.passengerFirstName,
        passengerLastName: booking.passengerLastName ?? '',
        execMobile: booking.execMobile,
        customerAccount: booking.accountCode,
        caseCode: booking.caseCode ?? '',
        contractPricePounds: String((booking.contractPricePence ?? 0) / 100),
        notes: booking.notes ?? '',
      });
      setError(null);
    }
  }, [isOpen, booking?.id]);

  if (!booking || !form) return null;
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('bookingId', booking.id);
    fd.set('pickupAt', form.pickupAt);
    fd.set('expectedDurationMinutes', String(form.expectedDurationMinutes));
    fd.set('pickupAddress', form.pickupAddress);
    fd.set('dropoffAddress', form.dropoffAddress);
    fd.set('passengerFirstName', form.passengerFirstName);
    fd.set('passengerLastName', form.passengerLastName);
    fd.set('execMobile', form.execMobile);
    fd.set('customerAccount', form.customerAccount);
    fd.set('caseCode', form.caseCode);
    fd.set('contractPricePounds', form.contractPricePounds);
    fd.set('notes', form.notes);
    startTransition(async () => {
      const result = await editBookingAction(fd);
      if (!result.ok) {
        setError(result.error ?? 'Could not save changes.');
        return;
      }
      onSaved(result.changedFields ?? []);
    });
  };

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      <form className="modal__card" style={{ width: 680 }} onSubmit={submit}>
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">Edit booking</div>
              <div className="modal__sub">
                Amend details before dispatch. Changes are logged to the history.
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

          <div className="form-section">
            <div className="form-section__head">Trip</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Pickup time<span className="req">*</span>
              </label>
              <div className="ctrl">
                <div className="field-inline">
                  <input
                    type="datetime-local"
                    value={form.pickupAt}
                    onChange={(e) => set('pickupAt', e.target.value)}
                  />
                  <select
                    value={form.expectedDurationMinutes}
                    onChange={(e) => set('expectedDurationMinutes', Number(e.target.value))}
                  >
                    {DURATIONS.map((d) => (
                      <option key={d} value={d}>
                        {DURATION_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                From<span className="req">*</span>
              </label>
              <div className="ctrl">
                <AddressAutocomplete
                  value={form.pickupAddress}
                  onChange={(v) => set('pickupAddress', v)}
                  ariaLabel="Pickup address"
                />
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                To<span className="req">*</span>
              </label>
              <div className="ctrl">
                <AddressAutocomplete
                  value={form.dropoffAddress}
                  onChange={(v) => set('dropoffAddress', v)}
                  ariaLabel="Dropoff address"
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Customer &amp; passenger</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Customer account<span className="req">*</span>
              </label>
              <div className="ctrl">
                <input
                  type="text"
                  value={form.customerAccount}
                  onChange={(e) => set('customerAccount', e.target.value)}
                  placeholder="e.g. LEGO Group, Mercedes-Benz UK"
                />
                <div className="hint">The company the trip is billed to — not the passenger.</div>
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Case code<span className="req">*</span>
              </label>
              <div className="ctrl">
                <input
                  type="text"
                  value={form.caseCode}
                  onChange={(e) => set('caseCode', e.target.value)}
                  placeholder="e.g. LEGO-2026-0142"
                />
                <div className="hint">Expense code the customer&apos;s company bills against.</div>
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Passenger<span className="req">*</span>
              </label>
              <div className="ctrl">
                <div className="field-inline">
                  <input
                    type="text"
                    value={form.passengerFirstName}
                    onChange={(e) => set('passengerFirstName', e.target.value)}
                    placeholder="First name"
                  />
                  <input
                    type="text"
                    value={form.passengerLastName}
                    onChange={(e) => set('passengerLastName', e.target.value)}
                    placeholder="Last name"
                  />
                </div>
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Exec mobile<span className="req">*</span>
              </label>
              <div className="ctrl">
                <input
                  type="tel"
                  value={form.execMobile}
                  onChange={(e) => set('execMobile', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Contract price</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Price</label>
              <div className="ctrl">
                <div className="money">
                  <div className="pfx">£</div>
                  <input
                    type="number"
                    step="1"
                    value={form.contractPricePounds}
                    onChange={(e) => set('contractPricePounds', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Notes for the driver</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Special instructions</label>
              <div className="ctrl">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <footer className="modal__foot">
          <span className="left">All changes are logged to the booking&apos;s history.</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={isPending}>
            <Icon.Check /> {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
