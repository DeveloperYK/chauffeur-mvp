'use client';

import { createBookingAction } from '@/app/(dashboard)/dashboard/new/actions';
import { getRouteEstimate } from '@/lib/routes';
import { PLACEHOLDER_PRICING_RULES, type ServiceType, quoteBooking } from '@/server/domain/pricing';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AddressAutocomplete } from './address-autocomplete';
import { Icon } from './icons';

interface NewBookingModalProps {
  isOpen: boolean;
  meName: string;
  onClose: () => void;
  onCreated: (bookingDay?: string) => void;
}

interface NewForm {
  serviceType: ServiceType;
  pickupAt: string;
  expectedDurationMinutes: number;
  distanceMeters: number | null;
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

/** Hourly as-directed hire is booked in whole-hour blocks. */
const HOURS = [2, 3, 4, 6, 8, 12];
const DEFAULT_HOURLY_MINUTES = 240; // 4 hours
const DEFAULT_TRANSFER_MINUTES = 60;
const ROUTE_DEBOUNCE_MS = 600;

const EMPTY: NewForm = {
  serviceType: 'transfer',
  pickupAt: '',
  expectedDurationMinutes: DEFAULT_TRANSFER_MINUTES,
  distanceMeters: null,
  pickupAddress: '',
  dropoffAddress: '',
  passengerFirstName: '',
  passengerLastName: '',
  execMobile: '',
  customerAccount: '',
  caseCode: '',
  contractPricePounds: '',
  notes: '',
};

const SAMPLES: Array<
  Omit<NewForm, 'pickupAt' | 'expectedDurationMinutes' | 'serviceType' | 'distanceMeters'> & {
    durationMin: number;
  }
> = [
  {
    passengerFirstName: 'Alexander',
    passengerLastName: 'Pemberton',
    execMobile: '+447911123456',
    customerAccount: 'Pemberton Capital',
    caseCode: 'PEMB-2026-0142',
    pickupAddress: 'The Connaught, Carlos Place, Mayfair, London W1K 2AL',
    dropoffAddress: 'Heathrow Terminal 5, Departures',
    contractPricePounds: '165',
    notes: 'Flight BA268 to LAX. Two large suitcases.',
    durationMin: 75,
  },
  {
    passengerFirstName: 'Mariana',
    passengerLastName: 'Bellini',
    execMobile: '+447400123456',
    customerAccount: 'Bellini & Co',
    caseCode: 'BELL-0098',
    pickupAddress: 'Soho House, 76 Dean Street, London W1D 3SQ',
    dropoffAddress: 'Gatwick North Terminal',
    contractPricePounds: '135',
    notes: 'Prefers a quiet driver.',
    durationMin: 90,
  },
  {
    passengerFirstName: 'Theodore',
    passengerLastName: 'Ashworth',
    execMobile: '+447822016000',
    customerAccount: 'Ashworth Legal',
    caseCode: 'ASH-CASE-7741',
    pickupAddress: '1 Embankment Place, London WC2N 6RH',
    dropoffAddress: 'Battersea Power Station — Office',
    contractPricePounds: '85',
    notes: '',
    durationMin: 60,
  },
];

function defaultDateTime(offsetH = 26): string {
  const d = new Date(Date.now() + offsetH * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function poundsFromPence(pence: number): string {
  return (pence / 100).toFixed(2);
}

export function NewBookingModal({ isOpen, meName, onClose, onCreated }: NewBookingModalProps) {
  const [form, setForm] = useState<NewForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [routeStatus, setRouteStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [isPending, startTransition] = useTransition();
  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm((f) => ({ ...f, pickupAt: f.pickupAt || defaultDateTime() }));
      setError(null);
    }
  }, [isOpen]);

  const set = <K extends keyof NewForm>(k: K, v: NewForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Auto-estimate a transfer's distance + drive time whenever both ends are set.
  useEffect(() => {
    if (routeTimer.current) clearTimeout(routeTimer.current);
    if (form.serviceType !== 'transfer') {
      setRouteStatus('idle');
      return;
    }
    if (form.pickupAddress.trim().length < 3 || form.dropoffAddress.trim().length < 3) {
      setRouteStatus('idle');
      return;
    }
    setRouteStatus('loading');
    routeTimer.current = setTimeout(async () => {
      const est = await getRouteEstimate(form.pickupAddress, form.dropoffAddress);
      if (!est) {
        setRouteStatus('failed');
        return;
      }
      setForm((p) =>
        p.serviceType === 'transfer'
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
  }, [form.serviceType, form.pickupAddress, form.dropoffAddress]);

  const quote = useMemo(() => {
    if (form.serviceType === 'hourly') {
      return quoteBooking(
        { serviceType: 'hourly', hours: form.expectedDurationMinutes / 60 },
        PLACEHOLDER_PRICING_RULES,
      );
    }
    if (form.distanceMeters != null) {
      return quoteBooking(
        { serviceType: 'transfer', distanceMeters: form.distanceMeters },
        PLACEHOLDER_PRICING_RULES,
      );
    }
    return null;
  }, [form.serviceType, form.expectedDurationMinutes, form.distanceMeters]);

  const switchService = (next: ServiceType) => {
    setForm((p) => ({
      ...p,
      serviceType: next,
      // Hourly has no destination/route; reset duration to a sensible default.
      dropoffAddress: next === 'hourly' ? '' : p.dropoffAddress,
      distanceMeters: null,
      expectedDurationMinutes:
        next === 'hourly' ? DEFAULT_HOURLY_MINUTES : DEFAULT_TRANSFER_MINUTES,
    }));
    setRouteStatus('idle');
  };

  const miles = form.distanceMeters != null ? (form.distanceMeters / 1609.344).toFixed(1) : null;

  const generateSample = () => {
    const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    if (!s) return;
    const d = new Date(Date.now() + (24 + Math.floor(Math.random() * 24)) * 3600_000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setForm({
      ...EMPTY,
      serviceType: 'transfer',
      pickupAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      expectedDurationMinutes: s.durationMin,
      distanceMeters: null,
      pickupAddress: s.pickupAddress,
      dropoffAddress: s.dropoffAddress,
      passengerFirstName: s.passengerFirstName,
      passengerLastName: s.passengerLastName,
      execMobile: s.execMobile,
      customerAccount: s.customerAccount,
      caseCode: s.caseCode,
      contractPricePounds: s.contractPricePounds,
      notes: s.notes,
    });
    setError(null);
  };

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set('serviceType', form.serviceType);
    fd.set('pickupAt', form.pickupAt);
    fd.set('expectedDurationMinutes', String(form.expectedDurationMinutes));
    fd.set('pickupAddress', form.pickupAddress);
    // Hourly hire has no destination; the server stores null.
    fd.set('dropoffAddress', form.serviceType === 'transfer' ? form.dropoffAddress : '');
    if (form.serviceType === 'transfer' && form.distanceMeters != null) {
      fd.set('distanceMeters', String(form.distanceMeters));
    }
    fd.set('passengerFirstName', form.passengerFirstName);
    fd.set('passengerLastName', form.passengerLastName);
    fd.set('execMobile', form.execMobile);
    fd.set('customerAccount', form.customerAccount);
    fd.set('caseCode', form.caseCode);
    fd.set('contractPricePounds', form.contractPricePounds || '0');
    fd.set('notes', form.notes);
    startTransition(async () => {
      const result = await createBookingAction(fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setForm(EMPTY);
      onCreated(result.bookingDay);
    });
  };

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      <form className="modal__card" style={{ width: 720 }} onSubmit={submit}>
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">Create booking</div>
              <div className="modal__sub">
                Capture the call. The exec receives an SMS once a driver accepts.
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
                <div className="hint">
                  {form.serviceType === 'transfer'
                    ? 'Point-to-point. Drive time and price are estimated from the route.'
                    : 'Driver at the exec’s disposal for a set number of hours — no fixed destination.'}
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
                  placeholder="e.g. Claridge's, Brook Street, Mayfair, W1K 4HR"
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
                      placeholder="e.g. Heathrow Terminal 5, Departures"
                      ariaLabel="Dropoff address"
                    />
                    <div className="hint">
                      {routeStatus === 'loading'
                        ? 'Estimating route…'
                        : routeStatus === 'ready' && miles
                          ? `≈ ${form.expectedDurationMinutes} min · ${miles} mi`
                          : routeStatus === 'failed'
                            ? 'Could not estimate the route — enter the duration manually.'
                            : 'Pick both ends to estimate the drive time.'}
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
                    <div className="hint">
                      Auto-filled from the route; adjust for traffic/buffer.
                    </div>
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
                  <div className="hint">How long the car is booked for. 2-hour minimum.</div>
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
                <input
                  type="text"
                  value={form.customerAccount}
                  onChange={(e) => set('customerAccount', e.target.value)}
                  placeholder="e.g. LEGO Group, Mercedes-Benz UK"
                />
                <div className="hint">
                  The company the trip is billed to — not the passenger. This is the account on the
                  invoice.
                </div>
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
                <div className="hint">
                  The expense code the customer&apos;s company uses to cover the cost. Required for
                  billing.
                </div>
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
                  placeholder="+44 7911 123 456"
                />
                <div className="hint">
                  International format with country code. Used for the &lsquo;booking
                  confirmed&rsquo; and &lsquo;en route&rsquo; SMS.
                </div>
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
                    placeholder="145"
                  />
                </div>
                {quote ? (
                  <div className="hint">
                    Suggested <strong>£{poundsFromPence(quote.amountPence)}</strong> —{' '}
                    {quote.breakdown.join(' + ')} (estimate).{' '}
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => set('contractPricePounds', poundsFromPence(quote.amountPence))}
                    >
                      Use
                    </button>
                  </div>
                ) : (
                  <div className="hint">
                    Contract price, excluding car park &amp; waiting time (the driver fills those
                    after the trip).
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section__head">Notes for the driver</div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                {form.serviceType === 'hourly' ? 'Area / instructions' : 'Special instructions'}
              </label>
              <div className="ctrl">
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder={
                    form.serviceType === 'hourly'
                      ? 'e.g. around central London for meetings, then back to the hotel'
                      : 'Flight number, terminal, meet-and-greet sign, quiet driver request…'
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <footer className="modal__foot">
          <span className="left">
            Created by <strong>{meName}</strong>. Lands in <strong>Unassigned</strong>.
          </span>
          <span className="spacer" />
          <button type="button" className="btn btn--success" onClick={generateSample}>
            <Icon.Reset /> Generate
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={isPending}>
            <Icon.Plus /> {isPending ? 'Creating…' : 'Create booking'}
          </button>
        </footer>
      </form>
    </div>
  );
}
