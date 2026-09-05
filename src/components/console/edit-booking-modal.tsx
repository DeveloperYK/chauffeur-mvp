'use client';

import { editBookingAction } from '@/app/(dashboard)/dashboard/console-actions';
import { milesStringFromMeters } from '@/lib/distance';
import { EXEC_NOTIFICATION_CHANNEL } from '@/lib/exec-channel';
import { hasPostcode, isValidUkPostcode, withPostcode } from '@/lib/postcode';
import { getRouteEstimate } from '@/lib/routes';
import type { ServiceType } from '@/server/db/schema';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AddressAutocomplete } from './address-autocomplete';
import { CustomerAccountAutocomplete } from './customer-account-autocomplete';
import { toLocalDateTimeInput } from './format';
import { Icon } from './icons';
import { POSTCODE_INVALID_MESSAGE, PostcodeField } from './postcode-field';
import type { ConsoleBooking } from './types';

/** "YYYY-MM" of a datetime-local value, or null when not yet a full date. */
function monthOf(pickupAt: string): string | null {
  return /^\d{4}-\d{2}/.test(pickupAt) ? pickupAt.slice(0, 7) : null;
}

interface EditBookingModalProps {
  booking: ConsoleBooking | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (changedFields: string[]) => void;
}

interface EditForm {
  serviceType: ServiceType;
  travelMode: '' | 'flight' | 'train';
  travelRef: string;
  pickupAt: string;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
  pickupAddress: string;
  dropoffAddress: string;
  /** Typed by the operator only when the address itself has no postcode. */
  pickupPostcode: string;
  dropoffPostcode: string;
  passengerFirstName: string;
  passengerLastName: string;
  execMobile: string;
  execEmail?: string;
  bookedByName: string;
  bookedByPhone: string;
  bookedByEmail: string;
  customerAccount: string;
  caseCode: string;
  contractPricePounds: string;
  subcontractorPricePounds: string;
  notes: string;
  operatorNotes: string;
}

const HOURS = [2, 3, 4, 6, 8, 12];
const DEFAULT_HOURLY_MINUTES = 240;
const DEFAULT_TRANSFER_MINUTES = 60;
const ROUTE_DEBOUNCE_MS = 600;

export function EditBookingModal({ booking, isOpen, onClose, onSaved }: EditBookingModalProps) {
  const [form, setForm] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postcodeErrors, setPostcodeErrors] = useState<Record<string, string>>({});
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [isPending, startTransition] = useTransition();
  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate the form only when the modal opens or the booking changes
  useEffect(() => {
    if (isOpen && booking) {
      setForm({
        serviceType: booking.serviceType,
        travelMode: booking.travelMode ?? '',
        travelRef: booking.travelRef ?? '',
        pickupAt: toLocalDateTimeInput(booking.pickupAt),
        expectedDurationMinutes: booking.expectedDurationMinutes,
        distanceMeters: booking.distanceMeters,
        pickupAddress: booking.pickupAddress,
        dropoffAddress: booking.dropoffAddress,
        pickupPostcode: '',
        dropoffPostcode: '',
        passengerFirstName: booking.passengerFirstName,
        passengerLastName: booking.passengerLastName ?? '',
        execMobile: booking.execMobile,
        execEmail: booking.execEmail ?? '',
        bookedByName: booking.bookedByName ?? '',
        bookedByPhone: booking.bookedByPhone ?? '',
        bookedByEmail: booking.bookedByEmail ?? '',
        customerAccount: booking.accountCode,
        caseCode: booking.caseCode ?? '',
        contractPricePounds:
          booking.contractPricePence != null ? String(booking.contractPricePence / 100) : '',
        subcontractorPricePounds:
          booking.subcontractorPricePence != null
            ? String(booking.subcontractorPricePence / 100)
            : '',
        notes: booking.notes ?? '',
        operatorNotes: booking.operatorNotes ?? '',
      });
      setError(null);
      setPostcodeErrors({});
      setRouteStatus('idle');
    }
  }, [isOpen, booking?.id]);

  const serviceType = form?.serviceType;
  const pickupAddress = form?.pickupAddress;
  const dropoffAddress = form?.dropoffAddress;

  // Re-estimate a transfer's distance + drive time when both ends are set.
  useEffect(() => {
    if (routeTimer.current) clearTimeout(routeTimer.current);
    if (serviceType !== 'transfer' || !pickupAddress || !dropoffAddress) {
      setRouteStatus('idle');
      return;
    }
    if (pickupAddress.trim().length < 3 || dropoffAddress.trim().length < 3) {
      setRouteStatus('idle');
      return;
    }
    setRouteStatus('loading');
    routeTimer.current = setTimeout(async () => {
      const est = await getRouteEstimate(pickupAddress, dropoffAddress);
      if (!est) {
        setRouteStatus('failed');
        return;
      }
      setForm((p) =>
        p && p.serviceType === 'transfer'
          ? {
              ...p,
              distanceMeters: est.distanceMeters,
              expectedDurationMinutes: est.durationMinutes,
            }
          : p,
      );
      setRouteStatus('ready');
    }, ROUTE_DEBOUNCE_MS);
    return () => {
      if (routeTimer.current) clearTimeout(routeTimer.current);
    };
  }, [serviceType, pickupAddress, dropoffAddress]);

  if (!booking || !form) return null;
  const set = <K extends keyof EditForm>(k: K, v: EditForm[K]) =>
    setForm((p) => (p ? { ...p, [k]: v } : p));

  const switchService = (next: ServiceType) => {
    setForm((p) =>
      p
        ? {
            ...p,
            serviceType: next,
            dropoffAddress: next === 'hourly' ? '' : p.dropoffAddress,
            distanceMeters: null,
            expectedDurationMinutes:
              next === 'hourly' ? DEFAULT_HOURLY_MINUTES : DEFAULT_TRANSFER_MINUTES,
          }
        : p,
    );
    setRouteStatus('idle');
  };

  const miles = milesStringFromMeters(form.distanceMeters) || null;
  // Prices are optional — blank clears them; a non-blank value must be positive.
  const priceFieldValid = (v: string) => v.trim() === '' || Number.parseFloat(v) > 0;
  const priceValid =
    priceFieldValid(form.contractPricePounds) && priceFieldValid(form.subcontractorPricePounds);

  const needsPickupPostcode =
    form.pickupAddress.trim().length > 0 && !hasPostcode(form.pickupAddress);
  const needsDropoffPostcode =
    form.serviceType === 'transfer' &&
    form.dropoffAddress.trim().length > 0 &&
    !hasPostcode(form.dropoffAddress);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setPostcodeErrors({});
    // A manual postcode is mandatory whenever the address lacks one — this is
    // how older bookings saved without a postcode get one on their next edit.
    const nextPostcodeErrors = {
      ...(needsPickupPostcode && !isValidUkPostcode(form.pickupPostcode)
        ? { pickupPostcode: POSTCODE_INVALID_MESSAGE }
        : {}),
      ...(needsDropoffPostcode && !isValidUkPostcode(form.dropoffPostcode)
        ? { dropoffPostcode: POSTCODE_INVALID_MESSAGE }
        : {}),
    };
    if (Object.keys(nextPostcodeErrors).length > 0) {
      setError('Please fix the highlighted fields.');
      setPostcodeErrors(nextPostcodeErrors);
      return;
    }
    const pickupAddress = withPostcode(form.pickupAddress, form.pickupPostcode);
    const dropoffAddress = withPostcode(form.dropoffAddress, form.dropoffPostcode);
    const fd = new FormData();
    fd.set('bookingId', booking.id);
    fd.set('serviceType', form.serviceType);
    fd.set('pickupAt', form.pickupAt);
    fd.set('expectedDurationMinutes', String(form.expectedDurationMinutes));
    fd.set('pickupAddress', pickupAddress);
    fd.set('dropoffAddress', form.serviceType === 'transfer' ? dropoffAddress : '');
    if (form.serviceType === 'transfer' && form.distanceMeters != null) {
      fd.set('distanceMeters', String(form.distanceMeters));
    }
    fd.set('passengerFirstName', form.passengerFirstName);
    fd.set('passengerLastName', form.passengerLastName);
    fd.set('execMobile', form.execMobile);
    fd.set('execEmail', form.execEmail ?? '');
    fd.set('bookedByName', form.bookedByName);
    fd.set('bookedByPhone', form.bookedByPhone);
    fd.set('bookedByEmail', form.bookedByEmail);
    fd.set('customerAccount', form.customerAccount);
    fd.set('caseCode', form.caseCode);
    fd.set('contractPricePounds', form.contractPricePounds);
    fd.set('subcontractorPricePounds', form.subcontractorPricePounds);
    fd.set('travelMode', form.travelMode);
    fd.set('travelRef', form.travelMode ? form.travelRef : '');
    fd.set('notes', form.notes);
    fd.set('operatorNotes', form.operatorNotes);
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
              {/* biome-ignore lint/a11y/noLabelWithoutControl: segmented control below */}
              <label>Service</label>
              <div className="ctrl">
                <div className="seg">
                  <button
                    type="button"
                    className={`btn ${form.serviceType === 'transfer' ? 'btn--primary' : ''}`}
                    onClick={() => switchService('transfer')}
                  >
                    Transfer
                  </button>
                  <button
                    type="button"
                    className={`btn ${form.serviceType === 'hourly' ? 'btn--primary' : ''}`}
                    onClick={() => switchService('hourly')}
                  >
                    As-directed (hourly)
                  </button>
                </div>
              </div>
            </div>

            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Pickup time<span className="req">*</span>
              </label>
              <div className="ctrl">
                <input
                  type="datetime-local"
                  value={form.pickupAt}
                  onChange={(e) => set('pickupAt', e.target.value)}
                />
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
            {needsPickupPostcode ? (
              <PostcodeField
                value={form.pickupPostcode}
                onChange={(v) => set('pickupPostcode', v)}
                ariaLabel="Pickup postcode"
                error={postcodeErrors.pickupPostcode}
              />
            ) : null}

            {form.serviceType === 'transfer' ? (
              <>
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
                    <div className="hint">
                      {routeStatus === 'loading'
                        ? 'Estimating route…'
                        : miles
                          ? `≈ ${form.expectedDurationMinutes} min · ${miles} mi`
                          : 'Drive time is estimated from the route.'}
                    </div>
                  </div>
                </div>
                {needsDropoffPostcode ? (
                  <PostcodeField
                    value={form.dropoffPostcode}
                    onChange={(v) => set('dropoffPostcode', v)}
                    ariaLabel="Dropoff postcode"
                    error={postcodeErrors.dropoffPostcode}
                  />
                ) : null}
                <div className="field">
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                  <label>Duration (min)</label>
                  <div className="ctrl">
                    <input
                      type="number"
                      min={15}
                      max={720}
                      value={form.expectedDurationMinutes || ''}
                      onChange={(e) =>
                        set(
                          'expectedDurationMinutes',
                          e.target.value === '' ? 0 : Number(e.target.value),
                        )
                      }
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>
                  Hours<span className="req">*</span>
                </label>
                <div className="ctrl">
                  <select
                    value={form.expectedDurationMinutes / 60}
                    onChange={(e) => set('expectedDurationMinutes', Number(e.target.value) * 60)}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {h} hours
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Flight / train</label>
              <div className="ctrl">
                <div className="row" style={{ gap: 8 }}>
                  <select
                    value={form.travelMode}
                    onChange={(e) => {
                      const mode = e.target.value as '' | 'flight' | 'train';
                      set('travelMode', mode);
                      if (!mode) set('travelRef', '');
                    }}
                    style={{ width: 110, flex: '0 0 auto' }}
                    aria-label="Arrival travel type"
                  >
                    <option value="">None</option>
                    <option value="flight">Flight</option>
                    <option value="train">Train</option>
                  </select>
                  {form.travelMode ? (
                    <input
                      value={form.travelRef}
                      onChange={(e) => set('travelRef', e.target.value)}
                      placeholder={
                        form.travelMode === 'flight' ? 'e.g. BA268' : 'e.g. 12:03 from Manchester'
                      }
                      aria-label="Flight or train reference"
                    />
                  ) : null}
                </div>
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
                <CustomerAccountAutocomplete
                  value={form.customerAccount}
                  onChange={(v) => set('customerAccount', v)}
                  month={monthOf(form.pickupAt)}
                  ariaLabel="Customer account"
                />
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
                />
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
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Exec email
                {EXEC_NOTIFICATION_CHANNEL === 'email' ? <span className="req">*</span> : null}
              </label>
              <div className="ctrl">
                <input
                  type="email"
                  value={form.execEmail ?? ''}
                  onChange={(e) => set('execEmail', e.target.value)}
                  required={EXEC_NOTIFICATION_CHANNEL === 'email'}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Booked by (PA)</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Name</label>
              <div className="ctrl">
                <input
                  type="text"
                  value={form.bookedByName}
                  onChange={(e) => set('bookedByName', e.target.value)}
                  placeholder="Who booked on the exec's behalf"
                />
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: controls nested in .ctrl */}
              <label>Contact</label>
              <div className="ctrl">
                <div className="field-inline">
                  <input
                    type="tel"
                    value={form.bookedByPhone}
                    onChange={(e) => set('bookedByPhone', e.target.value)}
                    placeholder="Phone"
                  />
                  <input
                    type="email"
                    value={form.bookedByEmail}
                    onChange={(e) => set('bookedByEmail', e.target.value)}
                    placeholder="Email"
                  />
                </div>
                <div className="hint">If filled in: name plus a phone or an email.</div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Pricing</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Contract price</label>
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
                <div className="hint">
                  Leave blank if not agreed yet — the booking is flagged until it has a price.
                </div>
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Subcontractor price</label>
              <div className="ctrl">
                <div className="money">
                  <div className="pfx">£</div>
                  <input
                    type="number"
                    step="1"
                    value={form.subcontractorPricePounds}
                    onChange={(e) => set('subcontractorPricePounds', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Notes</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                {form.serviceType === 'hourly'
                  ? 'Area / instructions for the driver'
                  : 'Notes for the driver'}
              </label>
              <div className="ctrl">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Private notes</label>
              <div className="ctrl">
                <textarea
                  rows={3}
                  value={form.operatorNotes}
                  onChange={(e) => set('operatorNotes', e.target.value)}
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
          <button type="submit" className="btn btn--primary" disabled={isPending || !priceValid}>
            <Icon.Check /> {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </form>
    </div>
  );
}
