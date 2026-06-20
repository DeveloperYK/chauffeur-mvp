'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { AUTO_REFRESH_INTERVAL_MS, shouldAutoRefresh } from './auto-refresh';

/**
 * Keep the operator console near-live by re-fetching the server component on an
 * interval, so changes made outside this tab (driver accepts a dispatch link,
 * the clock tick advances a booking, another operator's edit) appear without a
 * manual refresh.
 *
 * Pauses while an input modal is open (so a poll can't clobber typed input) and
 * while the tab is hidden; on returning to a visible tab it refreshes once
 * immediately to catch up on anything missed.
 *
 * @param inputOpen whether an input-bearing modal is currently open.
 */
export function useAutoRefresh(inputOpen: boolean): void {
  const router = useRouter();
  // The interval/listener closures are created once; read the latest `inputOpen`
  // through a ref so we never tear down and rebuild the timer on every keystroke.
  const inputOpenRef = useRef(inputOpen);
  inputOpenRef.current = inputOpen;

  useEffect(() => {
    const refreshIfAllowed = () => {
      if (shouldAutoRefresh({ inputOpen: inputOpenRef.current, tabHidden: document.hidden })) {
        router.refresh();
      }
    };

    const interval = window.setInterval(refreshIfAllowed, AUTO_REFRESH_INTERVAL_MS);
    // Returning to the tab may mean several missed intervals — catch up at once.
    document.addEventListener('visibilitychange', refreshIfAllowed);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshIfAllowed);
    };
  }, [router]);
}
