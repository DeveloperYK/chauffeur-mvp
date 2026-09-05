'use client';

import {
  execEmailDraftAction,
  sendExecEmailAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from './icons';

export type ExecEmailKind = 'assigned' | 'en_route' | 'changed';

export const EXEC_EMAIL_TITLE: Record<ExecEmailKind, string> = {
  assigned: 'Booking confirmation',
  en_route: 'Driver details',
  changed: 'Booking update',
};

interface SendExecEmailModalProps {
  bookingId: string;
  /** Which of the two emails to draft; null keeps the modal closed. */
  kind: ExecEmailKind | null;
  onClose: () => void;
  /** Called after a successful send so the panel can refresh its data. */
  onSent: (message: string) => void;
}

/**
 * Preview-and-send for the exec emails. The operator sees exactly what will go
 * out — recipient, subject, body — and can change any of it before pressing
 * send. The branded header, signature and confidentiality notice are applied
 * automatically around the body.
 */
export function SendExecEmailModal({ bookingId, kind, onClose, onSent }: SendExecEmailModalProps) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOpen = kind !== null;

  useEffect(() => {
    if (!kind) return;
    setLoading(true);
    setError(null);
    execEmailDraftAction(bookingId, kind)
      .then((res) => {
        if (res.ok && res.draft) {
          setTo(res.draft.to);
          setSubject(res.draft.subject);
          setBody(res.draft.body);
        } else {
          setError(res.error ?? 'Could not build the email.');
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, kind]);

  const send = () => {
    if (!kind) return;
    setError(null);
    startTransition(async () => {
      const res = await sendExecEmailAction({ bookingId, kind, to, subject, body });
      if (!res.ok) {
        setError(res.error ?? 'Could not send the email.');
        return;
      }
      onSent(`${EXEC_EMAIL_TITLE[kind]} email sent to ${to}.`);
    });
  };

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      <div className="modal__card" style={{ width: 620 }}>
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">
                {kind ? `Send ${EXEC_EMAIL_TITLE[kind].toLowerCase()} email` : ''}
              </div>
              <div className="modal__sub">
                Check it over and edit anything before it goes. The JJ header, signature and
                confidentiality notice are added automatically.
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
          {loading ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Building the email…
            </div>
          ) : (
            <>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>To</label>
                <div className="ctrl">
                  <input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>Subject</label>
                <div className="ctrl">
                  <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
                </div>
              </div>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>Email</label>
                <div className="ctrl">
                  <textarea
                    value={body}
                    rows={14}
                    style={{ fontFamily: 'inherit', lineHeight: 1.5 }}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={loading || isPending || !to || !subject || !body.trim()}
            onClick={send}
          >
            {isPending ? 'Sending…' : 'Send email'}
          </button>
        </footer>
      </div>
    </div>
  );
}
