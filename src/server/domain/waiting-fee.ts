/**
 * Driver waiting-time charge — pure domain logic.
 *
 * When a driver reports waiting beyond a free grace period, the customer is
 * charged a per-minute fee, and the driver is paid a share of that fee for
 * their time. This is derived live from the `waitingTimeMinutes` the driver
 * submits on the completion form — no money is stored on the booking, so
 * changing the rules below re-prices consistently everywhere it's shown.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDER RULES — replace `WAITING_FEE_RULES` (and only that         │
 * │ constant) with the company's confirmed waiting-charge policy when it    │
 * │ arrives. The shape — free period, per-minute rate, driver share —       │
 * │ is intentionally simple; richer rules plug in without changing callers. │
 * └─────────────────────────────────────────────────────────────────────┘
 */

export interface WaitingFeeRules {
  /** Minutes of waiting included before any charge applies. */
  freeMinutes: number;
  /** Charged to the customer for each minute beyond the free period. */
  perMinutePence: number;
  /** Percentage of the customer fee paid to the driver (0–100). */
  driverSharePercent: number;
}

/** TODO: replace with the company's confirmed waiting-charge policy. */
export const WAITING_FEE_RULES: WaitingFeeRules = {
  freeMinutes: 30, // first 30 min free
  perMinutePence: 50, // £0.50 / min thereafter
  driverSharePercent: 70, // driver keeps 70% of the waiting charge
};

export interface WaitingFee {
  /** Total waiting reported by the driver (0 when none recorded). */
  waitingMinutes: number;
  /** Minutes beyond the free period that are actually charged. */
  chargeableMinutes: number;
  /** What the customer is billed for waiting. */
  customerFeePence: number;
  /** The driver's share of the customer fee. */
  driverPayPence: number;
  /** What the company retains (customer fee − driver pay). */
  companyMarginPence: number;
}

const ZERO_FEE: WaitingFee = {
  waitingMinutes: 0,
  chargeableMinutes: 0,
  customerFeePence: 0,
  driverPayPence: 0,
  companyMarginPence: 0,
};

/**
 * Compute the waiting charge for a reported waiting time.
 *
 * `null`/non-positive minutes produce a zero fee. The driver share is rounded
 * to the nearest penny and the company margin absorbs the remainder, so
 * `driverPay + companyMargin` always reconciles to `customerFee`.
 */
export function waitingFee(
  waitingTimeMinutes: number | null,
  rules: WaitingFeeRules = WAITING_FEE_RULES,
): WaitingFee {
  if (waitingTimeMinutes === null || waitingTimeMinutes <= 0) return ZERO_FEE;

  const waitingMinutes = waitingTimeMinutes;
  const chargeableMinutes = Math.max(0, waitingMinutes - rules.freeMinutes);
  const customerFeePence = chargeableMinutes * rules.perMinutePence;
  const driverPayPence = Math.round((customerFeePence * rules.driverSharePercent) / 100);
  const companyMarginPence = customerFeePence - driverPayPence;

  return {
    waitingMinutes,
    chargeableMinutes,
    customerFeePence,
    driverPayPence,
    companyMarginPence,
  };
}
