'use client';

import {
  type SearchResult,
  searchBookingsAction,
} from '@/app/(dashboard)/dashboard/search-actions';
import type { BookingState } from '@/server/db/schema';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { fmtTimeWithDay, passengerName } from './format';
import { Icon } from './icons';

const STATE_LABEL: Record<BookingState, string> = {
  unassigned: 'Unassigned',
  assigned: 'Assigned',
  in_progress: 'In progress',
  awaiting_driver_form: 'Awaiting form',
  awaiting_operator_review: 'Awaiting review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DEBOUNCE_MS = 200;

interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic id so a slow response from an earlier keystroke can't overwrite
  // results from a later one (latest-wins).
  const reqId = useRef(0);

  // Focus on open; clear everything on close.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQ('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  // Debounced, latest-wins search.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myId = ++reqId.current;
    const timer = setTimeout(() => {
      searchBookingsAction(term).then((rows) => {
        if (myId === reqId.current) {
          setResults(rows);
          setLoading(false);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const term = q.trim();

  return (
    <div className="cmdk" aria-hidden={!open}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss; Esc provides keyboard access */}
      <div className="cmdk__scrim" onClick={onClose} />
      {/* biome-ignore lint/a11y/useSemanticElements: styled palette surface; native <dialog> conflicts with the design CSS */}
      <div className="cmdk__card" role="dialog" aria-modal="true" aria-label="Search bookings">
        <div className="cmdk__head">
          <Icon.Search />
          <input
            ref={inputRef}
            className="cmdk__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ID, name, address, company, phone…"
          />
          {loading ? <span className="cmdk__spin">…</span> : null}
          <kbd>Esc</kbd>
        </div>
        <div className="cmdk__results">
          {!term ? (
            <p className="cmdk__hint">
              Search a booking ref (<span className="mono">42</span> or{' '}
              <span className="mono">BKNG-00042</span>), a passenger or driver name, an address, a
              client company, or a phone number.
            </p>
          ) : null}
          {term && !loading && results.length === 0 ? (
            <p className="cmdk__hint">No bookings match “{term}”.</p>
          ) : null}
          {results.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/bookings/${r.id}`}
              className="cmdk__row"
              onClick={onClose}
            >
              <span className="cmdk__ref mono">{r.ref}</span>
              <span className="cmdk__when">{fmtTimeWithDay(r.pickupAt)}</span>
              <span className="cmdk__who">{passengerName(r)}</span>
              <span className="cmdk__driver">{r.driverName ?? '—'}</span>
              <span className="cmdk__state">{STATE_LABEL[r.state]}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
