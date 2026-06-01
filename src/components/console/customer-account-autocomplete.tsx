'use client';

import { accountSuggestionsAction } from '@/app/(dashboard)/dashboard/new/actions';
import type { AccountSuggestion } from '@/server/services/bookings-query';
import { useEffect, useId, useRef, useState } from 'react';

interface CustomerAccountAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Pickup month (YYYY-MM) the booking falls in; scopes the suggestions. */
  month: string | null;
  placeholder?: string;
  ariaLabel?: string;
}

/** Keep the menu open briefly after blur so an option click registers first. */
const BLUR_CLOSE_MS = 120;
/** Cap how many matches render under the field. */
const MAX_VISIBLE = 8;

/**
 * Customer-account field with a typeahead of accounts already used this month
 * (plus recent history). Picking one reuses the exact stored spelling, so the
 * monthly invoice doesn't fragment into "Lego" / "lego" / "Lego Group". It is a
 * plain text input otherwise — operators can always type a brand-new account.
 */
export function CustomerAccountAutocomplete({
  value,
  onChange,
  month,
  placeholder,
  ariaLabel,
}: CustomerAccountAutocompleteProps) {
  const [all, setAll] = useState<AccountSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const cacheRef = useRef<Map<string, AccountSuggestion[]>>(new Map());
  const blurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqRef = useRef(0);
  const listboxId = useId();

  // Load the month's accounts whenever the pickup month changes (cached per month).
  useEffect(() => {
    if (!month) {
      setAll([]);
      return;
    }
    const cached = cacheRef.current.get(month);
    if (cached) {
      setAll(cached);
      return;
    }
    const req = ++reqRef.current;
    accountSuggestionsAction(month)
      .then((rows) => {
        cacheRef.current.set(month, rows);
        if (reqRef.current === req) setAll(rows);
      })
      .catch(() => {
        if (reqRef.current === req) setAll([]);
      });
  }, [month]);

  useEffect(
    () => () => {
      if (blurRef.current) clearTimeout(blurRef.current);
    },
    [],
  );

  const trimmed = value.trim().toLowerCase();
  // Substring match; hide an account the operator has already typed exactly.
  const matches = all
    .filter((s) => {
      const a = s.account.toLowerCase();
      if (a === trimmed) return false;
      return trimmed.length === 0 || a.includes(trimmed);
    })
    .slice(0, MAX_VISIBLE);

  const showMenu = open && matches.length > 0;

  const choose = (s: AccountSuggestion) => {
    onChange(s.account);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showMenu) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      const picked = activeIndex >= 0 ? matches[activeIndex] : undefined;
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
        aria-expanded={showMenu}
        aria-autocomplete="list"
        aria-controls={listboxId}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
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
          {matches.map((s, i) => (
            // biome-ignore lint/a11y/useFocusableInteractive: options are not tab stops; selection is driven from the input (Arrow/Enter) per the combobox pattern.
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled on the input (Enter selects the active option); the click is a mouse affordance.
            <li
              key={s.account}
              // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: option role on the list item is the correct ARIA for a listbox.
              // biome-ignore lint/a11y/useSemanticElements: there is no semantic HTML element for a listbox option.
              role="option"
              aria-selected={i === activeIndex}
              className={`addr-ac__opt ${i === activeIndex ? 'is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(s)}
            >
              <span className="addr-ac__primary">{s.account}</span>
              <span className="addr-ac__secondary">{s.inMonth ? 'this month' : s.monthLabel}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
