'use client';

import { bookingTemplateAction } from '@/app/(dashboard)/dashboard/console-actions';
import {
  type SearchResult,
  searchBookingsAction,
} from '@/app/(dashboard)/dashboard/search-actions';
import type { BookingTemplate } from '@/lib/booking-template';
import { useEffect, useId, useRef, useState } from 'react';
import { fmtTimeWithDay, passengerName } from './format';

const DEBOUNCE_MS = 200;
const BLUR_CLOSE_MS = 120;

export interface CopiedFrom {
  ref: string;
  template: BookingTemplate;
}

interface CopyFromBookingProps {
  /** Called with the picked booking's reusable fields. */
  onPick: (copied: CopiedFrom) => void;
}

/**
 * "Copy from a previous booking": a search box at the top of the create form.
 * Most jobs are repeats — same exec and PA, same route — so the operator types
 * a name or company, picks the earlier booking, and only changes the date.
 */
export function CopyFromBooking({ onPick }: CopyFromBookingProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const reqId = useRef(0);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listboxId = useId();

  // Debounced, latest-wins search (same shape as the command palette).
  useEffect(() => {
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
        if (myId !== reqId.current) return;
        setResults(rows);
        setLoading(false);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const choose = async (r: SearchResult) => {
    setOpen(false);
    setError(null);
    let result: Awaited<ReturnType<typeof bookingTemplateAction>>;
    try {
      result = await bookingTemplateAction(r.id);
    } catch {
      setError('Could not load that booking. Please try again.');
      return;
    }
    if (!result.ok) {
      setError('That booking could not be found.');
      return;
    }
    setQ('');
    setResults([]);
    onPick({ ref: result.ref, template: result.template });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const picked = results[activeIndex];
      if (picked) {
        e.preventDefault();
        void choose(picked);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const term = q.trim();
  const showMenu = open && term.length > 0;

  return (
    <div className="field">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
      <label>Copy from</label>
      <div className="ctrl">
        <div className="addr-ac">
          <input
            type="text"
            value={q}
            placeholder="Previous booking — passenger, company or ref…"
            aria-label="Copy from a previous booking"
            role="combobox"
            aria-expanded={showMenu}
            aria-autocomplete="list"
            aria-controls={listboxId}
            autoComplete="off"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              if (blurRef.current) clearTimeout(blurRef.current);
              blurRef.current = setTimeout(() => setOpen(false), BLUR_CLOSE_MS);
            }}
          />
          {showMenu ? (
            // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern — focus stays on the input; the listbox is navigated via the input's keydown handler.
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox popup is the correct, intended pattern for an autocomplete list.
            // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox popup.
            <ul className="addr-ac__menu" id={listboxId} role="listbox">
              {loading && results.length === 0 ? (
                <li className="addr-ac__opt addr-ac__opt--muted">Searching…</li>
              ) : null}
              {!loading && results.length === 0 ? (
                <li className="addr-ac__opt addr-ac__opt--muted">No bookings match “{term}”.</li>
              ) : null}
              {results.map((r, i) => (
                // biome-ignore lint/a11y/useFocusableInteractive: options are not tab stops; selection is driven from the input (Arrow/Enter) per the combobox pattern.
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled on the input (Enter selects the active option); the click is a mouse affordance.
                <li
                  key={r.id}
                  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option role on the list item is the correct ARIA for a listbox.
                  // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox option.
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`addr-ac__opt ${i === activeIndex ? 'is-active' : ''}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => void choose(r)}
                >
                  <span className="addr-ac__primary">
                    <span className="mono">{r.ref}</span> · {passengerName(r)}
                  </span>
                  <span className="addr-ac__secondary">
                    {fmtTimeWithDay(r.pickupAt)} · {r.pickupAddress}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="hint">
          Pre-fills the form from an earlier job; you then set the new pickup time.
        </div>
        {error ? <div className="err">{error}</div> : null}
      </div>
    </div>
  );
}
