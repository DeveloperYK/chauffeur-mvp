'use client';

import { requestedVehicleClass } from '@/lib/car-type-match';
import { VEHICLE_CLASS_LABEL } from '@/lib/labels';
import type { VehicleClass } from '@/server/db/schema';

const VEHICLE_CLASSES = Object.keys(VEHICLE_CLASS_LABEL) as VehicleClass[];

interface CarTypeFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Requested car type: a quick-pick row of vehicle classes plus free text.
 * Picking a class REPLACES whatever is in the box (a fresh pick never appends
 * to or fights with the old value); picking the active class again clears it.
 * Anything else the PA asked for can still be typed in.
 */
export function CarTypeField({ id, value, onChange }: CarTypeFieldProps) {
  const active = requestedVehicleClass(value);
  const pick = (cls: VehicleClass) => onChange(active === cls ? '' : VEHICLE_CLASS_LABEL[cls]);

  return (
    <div className="field">
      <label htmlFor={id}>Car type</label>
      <div className="ctrl car-type">
        <div className="viewswitch car-type__picks" aria-label="Car type">
          {VEHICLE_CLASSES.map((cls) => (
            <button
              key={cls}
              type="button"
              className={active === cls ? 'is-active' : ''}
              aria-pressed={active === cls}
              onClick={() => pick(cls)}
            >
              {VEHICLE_CLASS_LABEL[cls]}
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
