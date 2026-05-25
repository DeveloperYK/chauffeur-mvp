'use client';

import {
  dispatchAction,
  sendDriverDispatchSmsAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { bookingRef } from '@/lib/booking-ref';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { Avatar } from './avatar';
import { fmtTimeWithDay, passengerName } from './format';
import { Icon } from './icons';
import { Lozenge } from './lozenge';
import type { AssignmentWindow, ConsoleBooking, ConsoleDriver } from './types';

interface DispatchModalProps {
  booking: ConsoleBooking | null;
  drivers: ConsoleDriver[];
  assignments: AssignmentWindow[];
  isOpen: boolean;
  onClose: () => void;
  onSent: (driverName: string) => void;
}

type Tier = 'all' | 'premium' | 'ordinary';

const WEEK_TARGET = 15;

export function DispatchModal({
  booking,
  drivers,
  assignments,
  isOpen,
  onClose,
  onSent,
}: DispatchModalProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [filter, setFilter] = useState<Tier>('all');
  const [search, setSearch] = useState('');
  const [minted, setMinted] = useState<{
    url: string;
    whatsappUrl: string;
    driverName: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset picker state only when the modal opens or the booking changes
  useEffect(() => {
    if (isOpen) {
      setPicked(null);
      setMinted(null);
      setFilter('all');
      setSearch('');
      setError(null);
      setCopied(false);
      setSmsMsg(null);
    }
  }, [isOpen, booking?.id]);

  // A driver is busy if any of their assignments overlaps this booking's window.
  const isBusy = useMemo(() => {
    if (!booking) return () => false;
    const start = new Date(booking.pickupAt).getTime();
    const end = start + (booking.expectedDurationMinutes || 60) * 60_000;
    return (driverId: string) =>
      assignments.some((a) => a.driverId === driverId && a.startMs < end && a.endMs > start);
  }, [booking, assignments]);

  const visible = useMemo(() => {
    return drivers
      .filter((d) => d.active)
      .filter((d) => (filter === 'all' ? true : d.tier === filter))
      .filter((d) => !search || d.name.toLowerCase().includes(search.toLowerCase()))
      .map((d) => ({ ...d, busy: isBusy(d.id) }))
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier === 'premium' ? -1 : 1;
        if (a.busy !== b.busy) return a.busy ? 1 : -1;
        return a.jobsThisWeek - b.jobsThisWeek;
      });
  }, [drivers, filter, search, isBusy]);

  if (!booking) return null;

  const generate = () => {
    if (!picked) return;
    setError(null);
    startTransition(async () => {
      const result = await dispatchAction(booking.id, picked);
      if (!result.ok || !result.url || !result.whatsappUrl) {
        setError(result.error ?? 'Could not generate the link.');
        return;
      }
      setMinted({
        url: result.url,
        whatsappUrl: result.whatsappUrl,
        driverName: result.driverName ?? 'driver',
      });
    });
  };

  const copyLink = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const messageDriver = () => {
    if (!picked) return;
    setSmsMsg(null);
    startTransition(async () => {
      const res = await sendDriverDispatchSmsAction(booking.id, picked);
      setSmsMsg(
        res.ok
          ? `Texted ${minted?.driverName?.split(' ')[0] ?? 'the driver'}.`
          : (res.error ?? 'Could not send SMS.'),
      );
    });
  };

  const expiry = fmtTimeWithDay(
    new Date(new Date(booking.pickupAt).getTime() + 48 * 3600_000).toISOString(),
  );

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      {/* biome-ignore lint/a11y/useSemanticElements: styled dialog surface; native <dialog> conflicts with the design CSS */}
      <div className="modal__card" style={{ width: 680 }} role="dialog" aria-modal="true">
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">
                Generate dispatch link{' '}
                <span className="mono" style={{ color: 'var(--ink-3)', fontWeight: 500 }}>
                  {bookingRef(booking.seq)}
                </span>
              </div>
              <div className="modal__sub">
                {passengerName(booking)} · {fmtTimeWithDay(booking.pickupAt)} ·{' '}
                {booking.accountCode}
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

          {!minted ? (
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
                  <button
                    type="button"
                    className={filter === 'premium' ? 'is-active' : ''}
                    onClick={() => setFilter('premium')}
                  >
                    Premium
                  </button>
                  <button
                    type="button"
                    className={filter === 'ordinary' ? 'is-active' : ''}
                    onClick={() => setFilter('ordinary')}
                  >
                    Ordinary
                  </button>
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
                  {visible.length} available
                </span>
              </div>

              <div className="dispatch-hint">
                <Icon.Question style={{ width: 12, height: 12 }} />
                <span>
                  <strong>Busy</strong> = driver has a job overlapping this pickup window.{' '}
                  <strong>Bandwidth bar</strong> shows their week load (~{WEEK_TARGET} jobs/wk).
                  Drivers with more free time rank higher.
                </span>
              </div>

              <div style={{ maxHeight: 380, overflowY: 'auto', padding: 1 }}>
                {visible.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-4)' }}>
                    No active drivers match.
                  </div>
                ) : null}
                {visible.map((d) => {
                  const loadPct = Math.min(100, Math.round((d.jobsThisWeek / WEEK_TARGET) * 100));
                  return (
                    <button
                      type="button"
                      key={d.id}
                      className={`driver-row ${picked === d.id ? 'is-selected' : ''} ${d.busy ? 'is-busy' : ''}`}
                      disabled={d.busy}
                      aria-pressed={picked === d.id}
                      onClick={() => setPicked(d.id)}
                      title={d.busy ? 'Already on a job at this time' : ''}
                    >
                      <Avatar name={d.name} id={d.id} size={32} />
                      <div>
                        <div className="driver-row__name">{d.name}</div>
                        <div className="driver-row__meta">
                          <span className={`tier-tag ${d.tier}`}>{d.tier}</span>
                          <span className="dotsep" />
                          <span>{d.defaultCarType}</span>
                        </div>
                      </div>
                      <div className="driver-row__bw" title={`${d.jobsThisWeek} jobs this week`}>
                        <div className="driver-row__bw-bar">
                          <i
                            style={{ width: `${loadPct}%` }}
                            className={loadPct > 80 ? 'high' : loadPct > 50 ? 'med' : ''}
                          />
                        </div>
                        <span className="driver-row__bw-lbl">
                          <strong>{d.jobsThisWeek}</strong>
                          <span>/{WEEK_TARGET} wk</span>
                        </span>
                      </div>
                      <div className="driver-row__avail">
                        {d.busy ? (
                          <Lozenge tone="red">BUSY</Lozenge>
                        ) : (
                          <Lozenge tone="green">FREE</Lozenge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="dispatch-result">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Avatar name={minted.driverName} id={picked ?? minted.driverName} size={36} />
                <div>
                  <div style={{ fontWeight: 600 }}>{minted.driverName}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Link ready — open it to test, or send it to the driver
                  </div>
                </div>
                <span style={{ flex: 1 }} />
                <Lozenge tone="green">LINK READY</Lozenge>
              </div>

              <div className="dispatch-result__url" style={{ marginTop: 12 }}>
                <Icon.Link style={{ width: 14, height: 14 }} />
                <span>{minted.url}</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 24, height: 24 }}
                  title="Copy link"
                  onClick={copyLink}
                >
                  <Icon.Copy style={{ width: 13, height: 13 }} />
                </button>
              </div>
              {copied ? (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                  Link copied to clipboard.
                </div>
              ) : null}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <a
                  className="btn"
                  style={{ flex: 1 }}
                  href={minted.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon.ArrowRight /> Open link (test)
                </a>
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ flex: 1 }}
                  onClick={messageDriver}
                  disabled={isPending}
                >
                  <Icon.Send /> {isPending ? 'Sending…' : 'Message driver (SMS)'}
                </button>
              </div>
              {smsMsg ? (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  {smsMsg}
                </div>
              ) : null}

              <a
                className="btn btn--block"
                style={{ marginTop: 8 }}
                href={minted.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon.Whatsapp /> Also message on WhatsApp (optional)
              </a>

              <div className="link-warning">
                <Icon.Flag style={{ width: 14, height: 14 }} />
                <span>
                  <strong>Do not share this link with other drivers.</strong> It&apos;s signed for{' '}
                  {minted.driverName} only — anyone opening it is recorded as them in the audit log.
                </span>
              </div>

              <div className="dispatch-result__hint">
                Driver can confirm or change the vehicle when they accept.
                <br />
                Link expires {expiry} · one-tap accept on the driver&apos;s phone.
              </div>
            </div>
          )}
        </div>

        <footer className="modal__foot">
          {!minted && picked ? (
            <span className="left">
              <span className="kbd-hint">↵</span> Generate link &nbsp;·&nbsp;{' '}
              <span className="kbd-hint">esc</span> Cancel
            </span>
          ) : (
            <span className="left">{minted ? 'Link ready.' : 'Tap a driver to continue.'}</span>
          )}
          <span className="spacer" />
          {!minted ? (
            <>
              <button type="button" className="btn" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!picked || isPending}
                onClick={generate}
              >
                <Icon.Link /> {isPending ? 'Generating…' : 'Generate link'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setMinted(null)}>
                ← Choose another driver
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => onSent(minted.driverName)}
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
