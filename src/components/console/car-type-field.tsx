'use client';

import { CAR_TYPES, carTypeFor } from '@/lib/car-type-match';

interface CarTypeFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Requested car type: a quick-pick row of JJ's vehicle types plus free text.
 * Picking a type REPLACES whatever is in the box (a fresh pick never appends
 * to or fights with the old value); picking the active type again clears it.
 * Anything else the PA asked for can still be typed in.
 */
export function CarTypeField({ id, value, onChange }: CarTypeFieldProps) {
  const active = carTypeFor(value)?.label ?? null;
  const pick = (label: string) => onChange(active === label ? '' : label);

  return (
    <div className="field">
      <label htmlFor={id}>Car type</label>
      <div className="ctrl car-type">
        <div className="viewswitch car-type__picks" aria-label="Car type">
          {CAR_TYPES.map((t) => (
            <button
              key={t.label}
              type="button"
              className={active === t.label ? 'is-active' : ''}
              aria-pressed={active === t.label}
              onClick={() => pick(t.label)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="or type another — optional"
          maxLength={60}
        />
      </div>
    </div>
  );
}
