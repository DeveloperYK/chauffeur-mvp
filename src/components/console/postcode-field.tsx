'use client';

/**
 * Manual postcode entry, shown under an address only while that address has no
 * postcode in it. Drivers navigate by postcode, so a booking cannot be saved
 * without one; the value is appended to the address on submit.
 */
interface PostcodeFieldProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  error?: string | undefined;
}

export const POSTCODE_INVALID_MESSAGE = 'Enter a valid UK postcode';

export function PostcodeField({ value, onChange, ariaLabel, error }: PostcodeFieldProps) {
  return (
    <div className="field">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
      <label>
        Postcode<span className="req">*</span>
      </label>
      <div className="ctrl">
        <input
          type="text"
          value={value}
          placeholder="e.g. NW1 2QP"
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="hint">
          This address has no postcode — add it so the driver can navigate.
        </div>
        {error ? <div className="err">{error}</div> : null}
      </div>
    </div>
  );
}
