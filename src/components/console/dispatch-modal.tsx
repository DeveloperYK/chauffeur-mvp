'use client';

import {
  type DispatchOfferResult,
  confirmAssignByPhoneAction,
  dispatchManyAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { carTypeMismatchNote, requestedVehicleClasses } from '@/lib/car-type-match';
import { type BusyWindow, firstClashingWindow } from '@/lib/driver-busy';
import { VEHICLE_CLASSES, VEHICLE_CLASS_SHORT, carDescription } from '@/lib/labels';
import { whatsappMobileLink } from '@/lib/whatsapp';
import type { VehicleClass } from '@/server/db/schema';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Avatar } from './avatar';
import { fmtTimeWithDay, passengerName, relTime } from './format';
import { Icon } from './icons';
import { Lozenge } from './lozenge';
import type { AssignmentWindow, ConsoleBooking, ConsoleDriver } from './types';

interface DispatchModalProps {
  booking: ConsoleBooking | null;
  drivers: ConsoleDriver[];
  assignments: AssignmentWindow[];
  isOpen: boolean;
  onClose: () => void;
  onSent: (summary: string) => void;
  /**
   * Mobile shell: hand the offer to the WhatsApp app (`wa.me`) rather than
   * WhatsApp Web, which does not run on a phone browser.
   */
  mobile?: boolean;
}

type ClassFilter = 'all' | VehicleClass;

/** HH:MM (London) for a busy-window epoch. */
function hhmm(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export function DispatchModal({
  booking,
  drivers,
  assignments,
  isOpen,
  onClose,
  onSent,
  mobile = false,
}: DispatchModalProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<ClassFilter>('all');
  const [search, setSearch] = useState('');
  // Once minted, the fan-out list of per-driver links the operator sends.
  const [offers, setOffers] = useState<DispatchOfferResult[] | null>(null);
  const [skippedCount, setSkippedCount] = useState(0);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Set once the operator has committed a driver by phone: the single "offer"
  // row is then the driver's job link (nothing to accept), and leaving the
  // modal by any route must refresh the board behind it.
  const [phoneAssigned, setPhoneAssigned] = useState<{ summary: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset picker state only when the modal opens or the booking changes
  useEffect(() => {
    if (isOpen) {
      setPicked(new Set());
      setOffers(null);
      setPhoneAssigned(null);
      setSkippedCount(0);
      setOpened(new Set());
      setCopiedId(null);
      setFilter('all');
      setSearch('');
      setError(null);
    }
  }, [isOpen, booking?.id]);

  // A driver is "busy" if one of their active jobs overlaps — or is within
  // 30 min of — this booking's window. Returns the clashing window so the row
  // can show *when* they're busy. Flags only; the operator can still send.
  const clashOf = useMemo(() => {
    if (!booking) return (_driverId: string): BusyWindow | null => null;
    const start = new Date(booking.pickupAt).getTime();
    const end = start + (booking.expectedDurationMinutes || 60) * 60_000;
    return (driverId: string) =>
      firstClashingWindow(
        assignments.filter((a) => a.driverId === driverId),
        start,
        end,
      );
  }, [booking, assignments]);

  const mobileWhatsappFor = (o: DispatchOfferResult): string => {
    const number = drivers.find((d) => d.id === o.driverId)?.whatsappNumber;
    return number ? whatsappMobileLink(number, o.message) : o.whatsappUrl;
  };

  const visible = useMemo(() => {
    return drivers
      .filter((d) => d.active)
      .filter((d) => (filter === 'all' ? true : d.vehicleClass === filter))
      .filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase()))
      .map((d) => {
        const clash = clashOf(d.id);
        return {
          ...d,
          busy: clash !== null,
          clash,
          mismatch: carTypeMismatchNote(booking?.requestedCarType, d.vehicleClass),
        };
      })
      .sort((a, b) => {
        if (a.vehicleClass !== b.vehicleClass)
          return VEHICLE_CLASSES.indexOf(a.vehicleClass) - VEHICLE_CLASSES.indexOf(b.vehicleClass);
        if (a.busy !== b.busy) return a.busy ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
  }, [drivers, filter, search, clashOf, booking?.requestedCarType]);

  if (!booking) return null;

  // Drivers already sitting on an open offer for this booking (operator sent a
  // link, no reply yet). Marked in the picker so they aren't re-offered blindly.
  const offeredIds = new Set(booking.openOffers.map((o) => o.driverId));

  // Opened on an already-assigned booking → this is a driver swap, not initial
  // dispatch. Only the operator-attested (phone) path applies (link-based swap
  // is out of scope); the fan-out "Offer" action is hidden. Mid-trip (the car
  // broke down, the driver is stuck) it is a *replacement*: same path, but the
  // modal shows the live-trip urgency and the trip never leaves in_progress.
  const isMidTrip = booking.state === 'in_progress';
  const isReassign = booking.state === 'assigned' || isMidTrip;
  const pickedDriver = picked.size === 1 ? drivers.find((d) => picked.has(d.id)) : undefined;

  const toggle = (driverId: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(driverId)) next.delete(driverId);
      else next.add(driverId);
      return next;
    });
  };

  const offerToSelected = () => {
    if (picked.size === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await dispatchManyAction(booking.id, [...picked]);
      if (!result.ok || !result.offers) {
        setError(result.error ?? 'Could not generate the links.');
        return;
      }
      setOffers(result.offers);
      setSkippedCount(result.skippedCount ?? 0);
    });
  };

  // Operator-attested assign: the operator phoned the single picked driver, who
  // agreed, so commit them directly — no offer link. In `assigned` state this
  // is a swap (the modal opens as "Reassign driver"). The driver never saw a
  // link, so the action hands back a job link for them, shown in the same
  // "send on WhatsApp / copy" row as a fan-out offer.
  const confirmByPhone = () => {
    if (picked.size !== 1) return;
    const driverId = [...picked][0] as string;
    setError(null);
    startTransition(async () => {
      const result = await confirmAssignByPhoneAction(booking.id, driverId);
      if (!result.ok) {
        setError(result.error ?? 'Could not assign the driver.');
        return;
      }
      const fullName = result.driverName ?? drivers.find((d) => d.id === driverId)?.name ?? '';
      const name = fullName.split(' ')[0] || 'driver';
      const summary = isMidTrip
        ? `Replaced with ${name} mid-trip — confirmed by phone.`
        : isReassign
          ? `Reassigned to ${name} — confirmed by phone.`
          : `Assigned ${name} — confirmed by phone.`;
      if (!result.url || !result.whatsappUrl || !result.message) {
        onSent(summary);
        return;
      }
      setPhoneAssigned({ summary });
      setOffers([
        {
          driverId,
          driverName: fullName,
          url: result.url,
          whatsappUrl: result.whatsappUrl,
          message: result.message,
        },
      ]);
    });
  };

  // After a phone assign the booking has already changed; closing by any route
  // (scrim, ×, Done) must report that so the board refreshes.
  const close = () => {
    if (phoneAssigned) onSent(phoneAssigned.summary);
    else onClose();
  };

  // Copy the same formatted message the WhatsApp button pre-fills (short link
  // included) — never the bare long signed URL.
  const copyMessage = async (offer: DispatchOfferResult) => {
    try {
      await navigator.clipboard.writeText(offer.message);
      setCopiedId(offer.driverId);
      setTimeout(() => setCopiedId((id) => (id === offer.driverId ? null : id)), 1500);
    } catch {
      setCopiedId(null);
    }
  };

  const markOpened = (driverId: string) => setOpened((prev) => new Set(prev).add(driverId));

  const expiry = fmtTimeWithDay(
    new Date(new Date(booking.pickupAt).getTime() + 48 * 3600_000).toISOString(),
  );

  const offerLabel = picked.size <= 1 ? 'Offer to 1 driver' : `Offer to ${picked.size} drivers`;
  // Requested car type vs. the ticked drivers' classes — a flag, never a block.
  const wantedKnown = requestedVehicleClasses(booking.requestedCarType).length > 0;
  const pickedMismatches = drivers.filter(
    (d) => picked.has(d.id) && carTypeMismatchNote(booking.requestedCarType, d.vehicleClass),
  ).length;
  const allOpened = offers?.every((o) => opened.has(o.driverId)) ?? false;

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={close} />
      {/* biome-ignore lint/a11y/useSemanticElements: styled dialog surface; native <dialog> conflicts with the design CSS */}
      <div className="modal__card" style={{ width: 680 }} role="dialog" aria-modal="true">
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">
                {phoneAssigned
                  ? 'Send the job link'
                  : offers
                    ? 'Send the links'
                    : isMidTrip
                      ? 'Replace driver'
                      : isReassign
                        ? 'Reassign driver'
                        : 'Find drivers'}{' '}
                <span className="mono" style={{ color: 'var(--ink-3)', fontWeight: 500 }}>
                  {bookingRef(booking.seq)}
                </span>
              </div>
              <div className="modal__sub">
                {passengerName(booking)} · {fmtTimeWithDay(booking.pickupAt)} ·{' '}
                {booking.accountCode ?? 'No account'}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="icon-btn" onClick={close}>
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

          {!offers && isMidTrip ? (
            <div className="ic ic--danger" style={{ marginBottom: 10 }}>
              <div className="ic__head">
                Trip in progress
                <span className="ic__head-meta" style={{ marginLeft: 8 }}>
                  Pickup {relTime(booking.pickupAt)}
                </span>
              </div>
              <div className="ic__body ic__body--prose">
                The current driver stays on the job until you confirm a replacement. Pick a free
                driver, call them, then confirm — they get the job link straight away.
              </div>
            </div>
          ) : null}

          {!offers ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div className="viewswitch">
                  <button
                    type="button"
                    className={filter === 'all' ? 'is-active' : ''}
                    onClick={() => setFilter('all')}
                  >
                    All
                  </button>
                  {VEHICLE_CLASSES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={filter === c ? 'is-active' : ''}
                      onClick={() => setFilter(c)}
                    >
                      {VEHICLE_CLASS_SHORT[c]}
                    </button>
                  ))}
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <input
                    className="input"
                    placeholder="Search drivers…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{ paddingLeft: 30 }}
                  />
                  <Icon.Search
                    style={{
                      position: 'absolute',
                      left: 9,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--ink-4)',
                      width: 14,
                      height: 14,
                    }}
                  />
                </div>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {picked.size > 0 ? `${picked.size} selected` : `${visible.length} available`}
                </span>
              </div>

              <div className="driver-list">
                {visible.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No active drivers match.
                  </div>
                ) : null}
                {visible.map((d) => {
                  const isPicked = picked.has(d.id);
                  return (
                    <button
                      type="button"
                      key={d.id}
                      className={`driver-row ${isPicked ? 'is-selected' : ''} ${d.busy ? 'is-busy' : ''}`}
                      aria-pressed={isPicked}
                      onClick={() => toggle(d.id)}
                      title={
                        d.clash
                          ? `Busy ${hhmm(d.clash.startMs)}–${hhmm(d.clash.endMs)} — you can still send`
                          : ''
                      }
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 5,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: isPicked
                            ? '1px solid var(--accent, #2e7d32)'
                            : '1px solid var(--hairline)',
                          background: isPicked ? 'var(--accent, #2e7d32)' : 'transparent',
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        {isPicked ? <Icon.Check style={{ width: 12, height: 12 }} /> : null}
                      </span>
                      <Avatar name={d.name} id={d.id} size={32} />
                      <div>
                        <div className="driver-row__name">{d.name}</div>
                        <div className="driver-row__meta">
                          <span className={`vc-tag ${d.vehicleClass}`}>
                            {VEHICLE_CLASS_SHORT[d.vehicleClass]}
                          </span>
                          <span className="dotsep" />
                          <span>{carDescription(d.car, d.carColour)}</span>
                        </div>
                        {d.mismatch ? (
                          <div className="driver-row__meta car-type-mismatch">
                            <Icon.Flag style={{ width: 11, height: 11 }} /> {d.mismatch}
                          </div>
                        ) : null}
                      </div>
                      <div className="driver-row__avail">
                        {offeredIds.has(d.id) ? (
                          <Lozenge tone="blue">OFFERED</Lozenge>
                        ) : d.clash ? (
                          <Lozenge tone="orange">
                            Busy {hhmm(d.clash.startMs)}–{hhmm(d.clash.endMs)}
                          </Lozenge>
                        ) : (
                          <Lozenge tone="green">Free</Lozenge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
              {pickedMismatches > 0 && wantedKnown ? (
                <div className="link-warning" data-testid="car-type-mismatch-warning">
                  <Icon.Flag style={{ width: 14, height: 14 }} />
                  <span>
                    <strong>
                      {pickedMismatches === 1
                        ? '1 selected driver'
                        : `${pickedMismatches} selected drivers`}{' '}
                      {pickedMismatches === 1 ? "doesn't" : "don't"} match the requested car type (
                      {booking.requestedCarType?.trim()}).
                    </strong>{' '}
                    You can still assign — just make sure the client is happy with the car.
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="dispatch-result">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                {phoneAssigned ? (
                  <>
                    <span style={{ fontWeight: 600 }}>{phoneAssigned.summary}</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      — send them the job link so they have the booking details.
                    </span>
                  </>
                ) : (
                  <>
                    <span style={{ fontWeight: 600 }}>
                      {offers.length} link{offers.length === 1 ? '' : 's'} ready
                    </span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      — send each driver theirs on WhatsApp.
                    </span>
                  </>
                )}
              </div>

              {skippedCount > 0 ? (
                <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
                  {skippedCount} driver{skippedCount === 1 ? '' : 's'} skipped (inactive or
                  unavailable).
                </div>
              ) : null}

              <div className="driver-list driver-list--offers">
                {offers.map((o) => (
                  <div key={o.driverId} className="offer-row" data-link={o.url}>
                    <Avatar name={o.driverName} id={o.driverId} size={32} />
                    <div className="offer-row__who">
                      <div className="offer-row__name">{o.driverName}</div>
                      <div className="offer-row__status">
                        {opened.has(o.driverId) ? (
                          <span className="offer-row__sent">
                            <Icon.Check style={{ width: 11, height: 11 }} /> Sent
                          </span>
                        ) : (
                          <span className="muted">Not sent yet</span>
                        )}
                      </div>
                    </div>
                    <div className="offer-row__actions">
                      <button
                        type="button"
                        className="btn btn--icon"
                        title={copiedId === o.driverId ? 'Copied' : 'Copy message'}
                        onClick={() => copyMessage(o)}
                      >
                        <Icon.Copy style={{ width: 13, height: 13 }} />
                      </button>
                      <a
                        className="btn btn--primary"
                        href={mobile ? mobileWhatsappFor(o) : o.whatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => markOpened(o.driverId)}
                      >
                        <Icon.Whatsapp /> WhatsApp
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              {phoneAssigned ? null : (
                <div className="link-warning">
                  <Icon.Flag style={{ width: 14, height: 14 }} />
                  <span>
                    <strong>Each link is signed for one driver.</strong> Send a driver only their
                    own row — anyone opening a link is recorded as that driver in the audit log.
                  </span>
                </div>
              )}

              <div className="dispatch-result__hint">
                {phoneAssigned
                  ? `Opens the job details on the driver's phone · expires ${expiry}.`
                  : `Links expire ${expiry} · one-tap accept on the driver's phone.`}
              </div>
            </div>
          )}
        </div>

        <footer className="modal__foot">
          <span className="left">
            {offers
              ? allOpened
                ? phoneAssigned
                  ? 'Sent.'
                  : 'All sent.'
                : phoneAssigned
                  ? 'Tap WhatsApp to send the job link.'
                  : 'Tap WhatsApp on each driver.'
              : picked.size > 0
                ? `${picked.size} selected.`
                : 'Tick drivers to offer this job to.'}
          </span>
          <span className="spacer" />
          {!offers ? (
            <>
              <button type="button" className="btn" onClick={close}>
                Close
              </button>
              {isReassign && pickedDriver ? (
                <a className="btn" href={`tel:${pickedDriver.whatsappNumber}`}>
                  <Icon.Phone /> Call {pickedDriver.name.split(' ')[0]}
                </a>
              ) : null}
              <button
                type="button"
                className={`btn ${isMidTrip ? 'btn--primary' : ''}`}
                disabled={picked.size !== 1 || isPending}
                onClick={confirmByPhone}
                title="Operator phoned the driver, who agreed — assign them directly"
              >
                <Icon.Phone /> {isPending ? 'Assigning…' : 'Confirmed by phone'}
              </button>
              {!isReassign ? (
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={picked.size === 0 || isPending}
                  onClick={offerToSelected}
                >
                  <Icon.Link /> {isPending ? 'Generating…' : offerLabel}
                </button>
              ) : null}
            </>
          ) : (
            <>
              {phoneAssigned ? null : (
                <button type="button" className="btn" onClick={() => setOffers(null)}>
                  ← Back to drivers
                </button>
              )}
              <button
                type="button"
                className="btn btn--primary"
                onClick={() =>
                  onSent(
                    phoneAssigned
                      ? phoneAssigned.summary
                      : offers.length === 1
                        ? `Offered to ${offers[0]?.driverName.split(' ')[0]}.`
                        : `Offered to ${offers.length} drivers.`,
                  )
                }
              >
                <Icon.Check /> Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
