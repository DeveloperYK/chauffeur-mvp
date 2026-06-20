/**
 * Auto-refresh policy for the operator console.
 *
 * The dashboard is a server component rendered once per request, so out-of-band
 * changes (a driver accepting a dispatch link, the clock tick advancing a
 * booking, another operator's edit) are invisible until the page re-fetches.
 * We poll with `router.refresh()` on an interval to keep the board near-live.
 *
 * This module holds the pure decision — *whether* to refresh right now — so it
 * can be unit-tested without a DOM. The wiring (timer + visibility listener)
 * lives in `use-auto-refresh.ts`.
 */

/** How often the console re-fetches when polling is allowed. */
export const AUTO_REFRESH_INTERVAL_MS = 5_000;

export interface AutoRefreshConditions {
  /**
   * An input-bearing modal (dispatch, edit, new booking, …) is open. Refreshing
   * would re-render the tree under the operator and risk clobbering typed input,
   * so we hold off until it closes.
   */
  inputOpen: boolean;
  /** The browser tab is hidden — no operator is looking, so don't waste queries. */
  tabHidden: boolean;
}

/** Whether the console should poll for fresh data given the current conditions. */
export function shouldAutoRefresh({ inputOpen, tabHidden }: AutoRefreshConditions): boolean {
  return !inputOpen && !tabHidden;
}
