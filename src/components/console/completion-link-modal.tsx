'use client';

import { bookingRef } from '@/lib/booking-ref';
import { useState } from 'react';
import { passengerName } from './format';
import { Icon } from './icons';
import type { ConsoleBooking } from './types';

export interface CompletionLink {
  url: string;
  whatsappUrl: string;
}

interface CompletionLinkModalProps {
  booking: ConsoleBooking;
  /** Whoever is driving — internal or backfill. Null if somehow unassigned. */
  driverName: string | null;
  link: CompletionLink | null;
  onClose: () => void;
}

/**
 * Shows a freshly minted driver completion-form link in a modal so the long
 * signed URL never has to squeeze into the detail panel. The operator copies
 * the link or fires it straight to the driver on WhatsApp.
 */
export function CompletionLinkModal({
  booking,
  driverName,
  link,
  onClose,
}: CompletionLinkModalProps) {
  const [copied, setCopied] = useState(false);
  const isOpen = link !== null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
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
              <div className="modal__title">
                Completion form link{' '}
                <span className="mono" style={{ color: 'var(--ink-3)', fontWeight: 500 }}>
                  {bookingRef(booking.seq)}
                </span>
              </div>
              <div className="modal__sub">
                {passengerName(booking)} · {booking.accountCode}
              </div>
            </div>
            <span style={{ flex: 1 }} />
            <button type="button" className="icon-btn" onClick={onClose}>
              <Icon.Close />
            </button>
          </div>
        </header>

        <div className="modal__body">
          <div className="dispatch-result__url" style={{ marginTop: 0 }}>
            <Icon.Link style={{ width: 14, height: 14 }} />
            <span>{link?.url}</span>
            <button
              type="button"
              className="btn btn--icon"
              title={copied ? 'Copied' : 'Copy link'}
              onClick={copy}
            >
              <Icon.Copy style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </div>

        <footer className="modal__foot">
          <span className="left">
            {driverName
              ? `Send it to ${driverName.split(' ')[0]} on WhatsApp.`
              : 'Send it to the driver on WhatsApp.'}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {link ? (
            <a
              className="btn btn--primary"
              href={link.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon.Whatsapp /> Message driver on WhatsApp
            </a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
