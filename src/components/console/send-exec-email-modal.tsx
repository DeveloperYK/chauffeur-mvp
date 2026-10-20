'use client';

import {
  execEmailDraftAction,
  sendExecEmailAction,
} from '@/app/(dashboard)/dashboard/console-actions';
import type { ExecEmailCopyOption } from '@/server/services/exec-notifications';
import { useEffect, useState, useTransition } from 'react';
import { Icon } from './icons';

export type ExecEmailKind = 'assigned' | 'en_route' | 'changed';

export const EXEC_EMAIL_TITLE: Record<ExecEmailKind, string> = {
  assigned: 'Booking confirmation',
  en_route: 'Driver details',
  changed: 'Booking update',
};

const COPY_ROLE_LABEL: Record<ExecEmailCopyOption['role'], string> = {
  pa: 'PA',
  exec: 'exec',
};

/** A details-table row in the editor; `id` is a client-only React key. */
interface EditableRow {
  id: number;
  label: string;
  value: string;
}

interface SendExecEmailModalProps {
  bookingId: string;
  /** Which email to draft; null keeps the modal closed. */
  kind: ExecEmailKind | null;
  onClose: () => void;
  /** Called after a successful send so the panel can refresh its data. */
  onSent: (message: string) => void;
}

/**
 * Preview-and-send for the exec emails. The operator edits the email as the
 * parts it is built from — intro, the details table (rows can be changed,
 * added, removed, reordered) and closing — and the server renders those parts
 * through the same branded layout as the pre-filled draft. Because nothing is
 * parsed back out of free text, an edit can never break the formatting.
 */
export function SendExecEmailModal({ bookingId, kind, onClose, onSent }: SendExecEmailModalProps) {
  const [to, setTo] = useState('');
  const [copyTo, setCopyTo] = useState<ExecEmailCopyOption | null>(null);
  const [copyTicked, setCopyTicked] = useState(false);
  const [ccText, setCcText] = useState('');
  const [subject, setSubject] = useState('');
  const [heading, setHeading] = useState('');
  const [intro, setIntro] = useState('');
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [closing, setClosing] = useState('');
  const [signedBy, setSignedBy] = useState('');
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
          setCopyTo(res.draft.copyTo);
          setCopyTicked(res.draft.copyTo !== null && res.draft.cc.includes(res.draft.copyTo.email));
          setCcText(res.draft.cc.filter((c) => c !== res.draft?.copyTo?.email).join(', '));
          setSubject(res.draft.subject);
          setHeading(res.draft.heading);
          setIntro(res.draft.intro);
          setRows(res.draft.rows.map((r, i) => ({ id: i, ...r })));
          setClosing(res.draft.closing);
          setSignedBy(res.signedBy ?? '');
        } else {
          setError(res.error ?? 'Could not build the email.');
        }
      })
      .finally(() => setLoading(false));
  }, [bookingId, kind]);

  const updateRow = (id: number, patch: Partial<Pick<EditableRow, 'label' | 'value'>>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));
  const moveRow = (id: number, dir: -1 | 1) =>
    setRows((prev) => {
      const i = prev.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j] as EditableRow, next[i] as EditableRow];
      return next;
    });
  const addRow = () =>
    setRows((prev) => [
      ...prev,
      { id: (prev.reduce((m, r) => Math.max(m, r.id), -1) ?? -1) + 1, label: '', value: '' },
    ]);

  const ccList = [
    ...(copyTo && copyTicked ? [copyTo.email] : []),
    ...ccText
      .split(/[,;\s]+/)
      .map((c) => c.trim())
      .filter(Boolean),
  ];
  const incompleteRow = rows.some((r) => !r.label.trim() || !r.value.trim());
  const empty = !intro.trim() && rows.length === 0 && !closing.trim();
  const canSend = !loading && !isPending && !!to && !!subject.trim() && !empty && !incompleteRow;

  const send = () => {
    if (!kind) return;
    setError(null);
    startTransition(async () => {
      const res = await sendExecEmailAction({
        bookingId,
        kind,
        to,
        cc: ccList,
        subject,
        intro,
        rows: rows.map(({ label, value }) => ({ label, value })),
        closing,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not send the email.');
        return;
      }
      const copied = ccList.length > 0 ? ` (copied to ${ccList.join(', ')})` : '';
      onSent(`${EXEC_EMAIL_TITLE[kind]} email sent to ${to}${copied}.`);
    });
  };

  return (
    <div className={`modal ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc and the close button provide keyboard access */}
      <div className="modal__scrim" onClick={onClose} />
      <div className="modal__card" style={{ width: 640 }}>
        <header className="modal__head">
          <div className="row">
            <div>
              <div className="modal__title">
                {kind ? `Send ${EXEC_EMAIL_TITLE[kind].toLowerCase()} email` : ''}
              </div>
              <div className="modal__sub">
                The JJ header, signature and confidentiality notice are added automatically.
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
                  <input
                    type="email"
                    aria-label="To"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </div>
              </div>
              {copyTo ? (
                <div className="field" style={{ paddingTop: 0 }}>
                  <span />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={copyTicked}
                      onChange={(e) => setCopyTicked(e.target.checked)}
                    />
                    Also send to the {COPY_ROLE_LABEL[copyTo.role]} ({copyTo.email})
                  </label>
                </div>
              ) : null}
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>CC</label>
                <div className="ctrl">
                  <input
                    type="text"
                    aria-label="CC"
                    value={ccText}
                    placeholder="Other addresses, comma-separated"
                    onChange={(e) => setCcText(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
                <label>Subject</label>
                <div className="ctrl">
                  <input
                    type="text"
                    aria-label="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
              </div>

              <div className="email-editor" data-testid="email-editor">
                <div className="email-editor__heading">{heading}</div>
                <textarea
                  aria-label="Intro"
                  className="email-editor__text"
                  rows={2}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                />
                <div className="email-editor__rows">
                  {rows.map((r, i) => (
                    <div key={r.id} className="email-row" data-testid="email-row">
                      <input
                        type="text"
                        aria-label="Label"
                        className="email-row__label"
                        value={r.label}
                        maxLength={40}
                        onChange={(e) => updateRow(r.id, { label: e.target.value })}
                      />
                      <input
                        type="text"
                        aria-label="Value"
                        className="email-row__value"
                        value={r.value}
                        maxLength={300}
                        onChange={(e) => updateRow(r.id, { value: e.target.value })}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Move up"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => moveRow(r.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Move down"
                        title="Move down"
                        disabled={i === rows.length - 1}
                        onClick={() => moveRow(r.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Remove"
                        title="Remove"
                        onClick={() => removeRow(r.id)}
                      >
                        <Icon.Close />
                      </button>
                    </div>
                  ))}
                  <div className="email-editor__rows-foot">
                    <button
                      type="button"
                      className="btn"
                      onClick={addRow}
                      disabled={rows.length >= 30}
                    >
                      <Icon.Plus /> Add detail
                    </button>
                    {incompleteRow ? (
                      <span className="err">Every detail needs a label and a value.</span>
                    ) : null}
                  </div>
                </div>
                <textarea
                  aria-label="Closing"
                  className="email-editor__text"
                  rows={2}
                  value={closing}
                  onChange={(e) => setClosing(e.target.value)}
                />
                {signedBy ? (
                  <div className="email-editor__signoff" aria-label="Sign-off">
                    Kind regards,
                    <br />
                    <strong>{signedBy}</strong>
                    <br />
                    JJ Chauffeuring Services
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!canSend} onClick={send}>
            {isPending ? 'Sending…' : 'Send email'}
          </button>
        </footer>
      </div>
    </div>
  );
}
