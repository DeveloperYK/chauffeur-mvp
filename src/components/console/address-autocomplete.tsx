'use client';

import { type AddressSuggestion, fetchAddressSuggestions, shouldQueryPlaces } from '@/lib/places';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

/** Debounce before hitting the Places API while the operator types. */
const DEBOUNCE_MS = 250;
/** Keep the menu open briefly after blur so an option click registers first. */
const BLUR_CLOSE_MS = 120;

/**
 * Address field with Google Places (New) autocomplete. Renders an ordinary
 * controlled `<input>` (so it pre-fills cleanly when editing) plus a dropdown of
 * UK address suggestions. Manual typing is always preserved — selecting a
 * suggestion just fills the field. When Places is unavailable (no API key, SSR,
 * or a failed lookup) it behaves exactly like a plain text input.
 */
export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  // Cancel any in-flight timers/requests on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blurRef.current) clearTimeout(blurRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  const runQuery = useCallback((input: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!shouldQueryPlaces(input)) {
      abortRef.current?.abort();
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const results = await fetchAddressSuggestions(input, controller.signal);
      if (controller.signal.aborted) return;

      setSuggestions(results);
      setActiveIndex(-1);
      setOpen(results.length > 0);
    }, DEBOUNCE_MS);
  }, []);

  const handleInput = (next: string) => {
    onChange(next);
    runQuery(next);
  };

  const choose = (s: AddressSuggestion) => {
    onChange(s.full);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const picked = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      if (picked) {
        e.preventDefault();
        choose(picked);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="addr-ac">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        autoComplete="off"
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          if (blurRef.current) clearTimeout(blurRef.current);
          blurRef.current = setTimeout(() => setOpen(false), BLUR_CLOSE_MS);
        }}
      />
      {open && suggestions.length > 0 ? (
        // biome-ignore lint/a11y/useFocusableInteractive: combobox pattern — focus stays on the input; the listbox is navigated via the input's keydown handler.
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA combobox popup is the correct, intended pattern for an autocomplete list.
        // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox popup.
        <ul className="addr-ac__menu" id={listboxId} role="listbox">
          {suggestions.map((s, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: options are not tab stops; selection is driven from the input (Arrow/Enter) per the combobox pattern.
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled on the input (Enter selects the active option); the click is a mouse affordance.
            <li
              key={s.id}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option role on the list item is the correct ARIA for a listbox.
              // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox option.
              role="option"
              aria-selected={i === activeIndex}
              className={`addr-ac__opt ${i === activeIndex ? 'is-active' : ''}`}
              // Prevent the input's blur from firing before the click.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(s)}
            >
              <span className="addr-ac__primary">{s.primary}</span>
              {s.secondary ? <span className="addr-ac__secondary">{s.secondary}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
