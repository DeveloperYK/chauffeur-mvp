'use client';

import { createBookingAction } from '@/app/(dashboard)/dashboard/new/actions';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from './icons';

interface NewBookingModalProps {
  isOpen: boolean;
  meName: string;
  onClose: () => void;
  onCreated: (bookingDay?: string) => void;
}

interface NewForm {
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

const EMPTY: NewForm = {
  pickupAt: '',
  expectedDurationMinutes: 90,
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
  Omit<NewForm, 'pickupAt' | 'expectedDurationMinutes'> & { durationMin: number }
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

export function NewBookingModal({ isOpen, meName, onClose, onCreated }: NewBookingModalProps) {
  const [form, setForm] = useState<NewForm>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (isOpen) {
      setForm((f) => ({ ...f, pickupAt: f.pickupAt || defaultDateTime() }));
      setError(null);
    }
  }, [isOpen]);

  const set = <K extends keyof NewForm>(k: K, v: NewForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  const generateSample = () => {
    const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
    if (!s) return;
    const d = new Date(Date.now() + (24 + Math.floor(Math.random() * 24)) * 3600_000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    setForm({
      pickupAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      expectedDurationMinutes: s.durationMin,
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
    fd.set('pickupAt', form.pickupAt);
    fd.set('expectedDurationMinutes', String(form.expectedDurationMinutes));
    fd.set('pickupAddress', form.pickupAddress);
    fd.set('dropoffAddress', form.dropoffAddress);
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
                <input
                  type="text"
                  value={form.pickupAddress}
                  onChange={(e) => set('pickupAddress', e.target.value)}
                  placeholder="e.g. Claridge's, Brook Street, Mayfair, W1K 4HR"
                />
              </div>
            </div>
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>
                To<span className="req">*</span>
              </label>
              <div className="ctrl">
                <input
                  type="text"
                  value={form.dropoffAddress}
                  onChange={(e) => set('dropoffAddress', e.target.value)}
                  placeholder="e.g. Heathrow Terminal 5, Departures"
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
                <div className="hint">
                  Contract price, excluding car park &amp; waiting time (the driver fills those
                  after the trip).
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
                  placeholder="Flight number, terminal, meet-and-greet sign, quiet driver request…"
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
