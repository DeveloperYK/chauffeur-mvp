'use client';

import { editBookingAction } from '@/app/(dashboard)/dashboard/console-actions';
import { EXEC_NOTIFICATION_CHANNEL } from '@/lib/exec-channel';
import { getRouteEstimate } from '@/lib/routes';
import type { ServiceType } from '@/server/db/schema';
import { useEffect, useRef, useState, useTransition } from 'react';
import { AddressAutocomplete } from './address-autocomplete';
import { CustomerAccountAutocomplete } from './customer-account-autocomplete';
import { toLocalDateTimeInput } from './format';
import { Icon } from './icons';
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
  pickupAt: string;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
  pickupAddress: string;
  dropoffAddress: string;
  passengerFirstName: string;
  passengerLastName: string;
  execMobile: string;
  execEmail?: string;
  customerAccount: string;
  caseCode: string;
  contractPricePounds: string;
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
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [isPending, startTransition] = useTransition();
  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hydrate the form only when the modal opens or the booking changes
  useEffect(() => {
    if (isOpen && booking) {
      setForm({
        serviceType: booking.serviceType,
        pickupAt: toLocalDateTimeInput(booking.pickupAt),
        expectedDurationMinutes: booking.expectedDurationMinutes,
        distanceMeters: booking.distanceMeters,
        pickupAddress: booking.pickupAddress,
        dropoffAddress: booking.dropoffAddress,
        passengerFirstName: booking.passengerFirstName,
        passengerLastName: booking.passengerLastName ?? '',
        execMobile: booking.execMobile,
        execEmail: booking.execEmail ?? '',
        customerAccount: booking.accountCode,
        caseCode: booking.caseCode ?? '',
        contractPricePounds: String((booking.contractPricePence ?? 0) / 100),
        notes: booking.notes ?? '',
        operatorNotes: booking.operatorNotes ?? '',
      });
      setError(null);
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

  const miles = form.distanceMeters != null ? (form.distanceMeters / 1609.344).toFixed(1) : null;
  const priceValid = Number.parseFloat(form.contractPricePounds) > 0;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('bookingId', booking.id);
    fd.set('serviceType', form.serviceType);
    fd.set('pickupAt', form.pickupAt);
    fd.set('expectedDurationMinutes', String(form.expectedDurationMinutes));
    fd.set('pickupAddress', form.pickupAddress);
    fd.set('dropoffAddress', form.serviceType === 'transfer' ? form.dropoffAddress : '');
    if (form.serviceType === 'transfer' && form.distanceMeters != null) {
      fd.set('distanceMeters', String(form.distanceMeters));
    }
    fd.set('passengerFirstName', form.passengerFirstName);
    fd.set('passengerLastName', form.passengerLastName);
    fd.set('execMobile', form.execMobile);
    fd.set('execEmail', form.execEmail ?? '');
    fd.set('customerAccount', form.customerAccount);
    fd.set('caseCode', form.caseCode);
    fd.set('contractPricePounds', form.contractPricePounds);
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
                        : routeStatus === 'ready' && miles
                          ? `≈ ${form.expectedDurationMinutes} min · ${miles} mi`
                          : 'Drive time is estimated from the route.'}
                    </div>
                  </div>
                </div>
                <div className="field">
                  {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                  <label>Duration (min)</label>
                  <div className="ctrl">
                    <input
                      type="number"
                      min={15}
                      max={720}
                      value={form.expectedDurationMinutes}
                      onChange={(e) => set('expectedDurationMinutes', Number(e.target.value))}
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
                  <div className="hint">
                    No fixed destination — the car is at the exec’s disposal.
                  </div>
                </div>
              </div>
            )}
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
                  placeholder="e.g. LEGO Group, Mercedes-Benz UK"
                  ariaLabel="Customer account"
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
                  placeholder="exec@example.com"
                  required={EXEC_NOTIFICATION_CHANNEL === 'email'}
                />
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Contract price</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                Price<span className="req">*</span>
              </label>
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
                <div className="hint">Contract price, excluding car park &amp; waiting time.</div>
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
              <div className="hint">The driver sees this on their job link.</div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Private notes — operators only</label>
              <div className="ctrl">
                <textarea
                  rows={3}
                  value={form.operatorNotes}
                  onChange={(e) => set('operatorNotes', e.target.value)}
                  placeholder="e.g. difficult client, account on stop, billing quirk…"
                />
              </div>
              <div className="hint">🔒 Never shown to the driver.</div>
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
