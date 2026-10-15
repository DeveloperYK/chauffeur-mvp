'use client';

import { wheelTargetToBlur } from '@/lib/number-input-wheel';
import { useEffect } from 'react';

/**
 * Stops trackpad/mouse-wheel scrolling from stepping the value of whichever
 * number field is focused. Mounted once in the root layout so it covers the
 * console modals and the public driver forms alike. The listener is passive:
 * it never blocks the scroll, it only drops focus from the field.
 */
export function NumberInputWheelGuard() {
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      wheelTargetToBlur(event.target, document.activeElement)?.blur();
    };
    document.addEventListener('wheel', onWheel, { passive: true });
    return () => document.removeEventListener('wheel', onWheel);
  }, []);
  return null;
}
