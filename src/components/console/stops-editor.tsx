'use client';

import { hasPostcode } from '@/lib/postcode';
import { MAX_STOPS } from '@/lib/stops';
import { AddressAutocomplete } from './address-autocomplete';
import { Icon } from './icons';
import { PostcodeField } from './postcode-field';

/** A stop as the create/edit forms hold it; `id` is a client-only React key. */
export interface FormStop {
  id: number;
  address: string;
  /** Typed by the operator only when the address itself has no postcode. */
  postcode: string;
  plannedWaitMinutes: number;
}

export function newFormStop(
  id: number,
  init: { address?: string; plannedWaitMinutes?: number } = {},
): FormStop {
  return {
    id,
    address: init.address ?? '',
    postcode: '',
    plannedWaitMinutes: init.plannedWaitMinutes ?? 0,
  };
}

/** Next client key: one more than the largest in use. */
export function nextStopId(stops: readonly FormStop[]): number {
  return stops.reduce((m, s) => Math.max(m, s.id), -1) + 1;
}

interface StopsEditorProps {
  stops: FormStop[];
  onChange: (stops: FormStop[]) => void;
  /** Server/client field errors keyed `stops.<i>.address` / `stops.<i>.postcode`. */
  fieldErrors: Record<string, string>;
}

/**
 * The intermediate stops of a multi-stop transfer, between the From and To
 * fields. Each stop is an address (same autocomplete + postcode rule as the
 * ends) plus the planned wait there, and can be moved or removed. Pure
 * presentation: the parent owns the array.
 */
export function StopsEditor({ stops, onChange, fieldErrors }: StopsEditorProps) {
  const update = (id: number, patch: Partial<Omit<FormStop, 'id'>>) =>
    onChange(stops.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: number) => onChange(stops.filter((s) => s.id !== id));
  const move = (id: number, dir: -1 | 1) => {
    const i = stops.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j] as FormStop, next[i] as FormStop];
    onChange(next);
  };
  const add = () => onChange([...stops, newFormStop(nextStopId(stops))]);

  return (
    <div className="stops-editor" data-testid="stops-editor">
      {stops.map((stop, i) => {
        const needsPostcode = stop.address.trim().length > 0 && !hasPostcode(stop.address);
        const addressError = fieldErrors[`stops.${i}.address`];
        return (
          <div key={stop.id} className="stop" data-testid="stop-row">
            <div className="field">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: control nested in .ctrl */}
              <label>Stop {i + 1}</label>
              <div className="ctrl">
                <AddressAutocomplete
                  value={stop.address}
                  onChange={(v) => update(stop.id, { address: v })}
                  placeholder="Start typing an address…"
                  ariaLabel={`Stop ${i + 1} address`}
                />
                <div className="stop__row">
                  <label className="stop__wait">
                    Wait here (min)
                    <input
                      type="number"
                      min={0}
                      max={720}
                      step={5}
                      aria-label={`Stop ${i + 1} wait minutes`}
                      value={stop.plannedWaitMinutes || ''}
                      placeholder="0"
                      onChange={(e) =>
                        update(stop.id, {
                          plannedWaitMinutes: e.target.value === '' ? 0 : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <span style={{ flex: 1 }} />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move stop ${i + 1} up`}
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => move(stop.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Move stop ${i + 1} down`}
                    title="Move down"
                    disabled={i === stops.length - 1}
                    onClick={() => move(stop.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Remove stop ${i + 1}`}
                    title="Remove stop"
                    onClick={() => remove(stop.id)}
                  >
                    <Icon.Close />
                  </button>
                </div>
                {addressError ? <div className="err">{addressError}</div> : null}
              </div>
            </div>
            {needsPostcode ? (
              <PostcodeField
                value={stop.postcode}
                onChange={(v) => update(stop.id, { postcode: v })}
                ariaLabel={`Stop ${i + 1} postcode`}
                error={fieldErrors[`stops.${i}.postcode`]}
              />
            ) : null}
          </div>
        );
      })}
      <div className="field">
        <span />
        <div className="ctrl">
          <button
            type="button"
            className="btn"
            onClick={add}
            disabled={stops.length >= MAX_STOPS}
            data-testid="add-stop"
          >
            <Icon.Plus /> Add a stop
          </button>
          {stops.length >= MAX_STOPS ? (
            <div className="hint">A journey can have at most {MAX_STOPS} stops.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
