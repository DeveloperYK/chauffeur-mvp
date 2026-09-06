'use client';

import {
  type AddressSuggestion,
  type PlacesSessionToken,
  createPlacesSessionToken,
  fetchAddressSuggestions,
  resolveSelectedAddress,
  shouldQueryPlaces,
} from '@/lib/places';
import { extractPostcode } from '@/lib/postcode';
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
 * suggestion fills the field immediately with the prediction text, then swaps in
 * the same text with a guaranteed postcode (Place Details, or reverse-geocoded
 * for airports/large buildings) once resolution answers; a confirmation line
 * shows the postcode that was found. "Enter address manually" (or Esc) switches
 * the field to manual mode: suggestions stay off until the operator clears the
 * field or clicks "Use lookup". When Places is unavailable (no API key, SSR, or
 * a failed lookup) it behaves exactly like a plain text input.
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
  /** Manual mode: operator asked the dropdown to stay out of the way. */
  const [manual, setManual] = useState(false);
  /** Postcode confirmed in the field after a lookup selection resolved. */
  const [foundPostcode, setFoundPostcode] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** One session spans the keystrokes up to a selection; renewed after each pick. */
  const sessionRef = useRef<Promise<PlacesSessionToken> | null>(null);
  /** Latest field value, so a late postcode never clobbers text typed after the pick. */
  const valueRef = useRef(value);
  valueRef.current = value;
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

      sessionRef.current ??= createPlacesSessionToken();
      const results = await fetchAddressSuggestions(
        input,
        controller.signal,
        await sessionRef.current,
      );
      if (controller.signal.aborted) return;

      setSuggestions(results);
      setActiveIndex(-1);
      setOpen(results.length > 0);
    }, DEBOUNCE_MS);
  }, []);

  const handleInput = (next: string) => {
    onChange(next);
    setFoundPostcode(null);
    if (manual) {
      // Clearing the field ends manual mode; otherwise stay out of the way.
      if (next.trim().length === 0) setManual(false);
      return;
    }
    runQuery(next);
  };

  /** Stop suggesting for this field until it is cleared or lookup is resumed. */
  const enterManualMode = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    setManual(true);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const resumeLookup = () => {
    setManual(false);
    runQuery(valueRef.current);
  };

  const choose = (s: AddressSuggestion) => {
    onChange(s.full);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
    // The details call closes this session; the next keystroke starts a fresh one.
    sessionRef.current = null;
    void resolveSelectedAddress(s).then((resolved) => {
      if (valueRef.current !== s.full) return;
      if (resolved !== s.full) onChange(resolved);
      setFoundPostcode(extractPostcode(resolved));
    });
  };

  // The "Enter address manually" row sits after the last suggestion.
  const manualRowIndex = suggestions.length;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, manualRowIndex));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIndex === manualRowIndex) {
        e.preventDefault();
        enterManualMode();
        return;
      }
      const picked = activeIndex >= 0 ? suggestions[activeIndex] : undefined;
      if (picked) {
        e.preventDefault();
        choose(picked);
      }
    } else if (e.key === 'Escape') {
      // Consume the key: the board's global Esc handler would close the whole
      // modal while the operator only meant to dismiss the suggestions.
      e.stopPropagation();
      enterManualMode();
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
          if (!manual && suggestions.length > 0) setOpen(true);
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
          {/* biome-ignore lint/a11y/useFocusableInteractive: same combobox pattern as the options above. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: Enter on the active row is handled on the input. */}
          <li
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option role on the list item is the correct ARIA for a listbox.
            // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox option.
            role="option"
            aria-selected={activeIndex === manualRowIndex}
            className={`addr-ac__opt addr-ac__opt--manual ${
              activeIndex === manualRowIndex ? 'is-active' : ''
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActiveIndex(manualRowIndex)}
            onClick={enterManualMode}
          >
            Enter address manually
          </li>
        </ul>
      ) : null}
      {manual ? (
        <div className="addr-ac__note">
          Suggestions off.{' '}
          <button type="button" className="addr-ac__link" onClick={resumeLookup}>
            Use lookup
          </button>
        </div>
      ) : null}
      {foundPostcode ? (
        <div className="addr-ac__note addr-ac__note--ok">Postcode found: {foundPostcode} ✓</div>
      ) : null}
    </div>
  );
}
