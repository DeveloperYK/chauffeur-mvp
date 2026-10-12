'use client';
import { useEffect, useState } from 'react';

/**
 * The single breakpoint below which the console lays itself out for a phone
 * (see the `@media` block at the end of console.css). Kept in one place so the
 * CSS and the few behaviours that must match it — which WhatsApp link to hand
 * out — never drift apart.
 */
export const PHONE_MEDIA_QUERY = '(max-width: 768px)';

/**
 * True once mounted on a phone-sized viewport. Starts false on the server and
 * on the first client render so hydration matches; flips in an effect and
 * tracks rotation / resizing afterwards.
 */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(PHONE_MEDIA_QUERY);
    const update = () => setIsPhone(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);
  return isPhone;
}
