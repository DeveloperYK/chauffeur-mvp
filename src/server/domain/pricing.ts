/**
 * Booking price quoting — pure domain logic.
 *
 * This computes a *suggested* contract price from the booking's measurable
 * inputs (route distance for transfers, hours for hourly hire). The operator
 * can always override the suggestion on the form.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ PLACEHOLDER RULES — replace `PLACEHOLDER_PRICING_RULES` (and only      │
 * │ that constant) with the company's real rate card when it arrives.      │
 * │ The shape below — minimum fare, base, per-mile, hourly rate, minimum   │
 * │ hours — is deliberately simple; richer rules (vehicle class, airport   │
 * │ surcharge, time-of-day, waiting time) plug into `PricingRules` and      │
 * │ `quoteBooking` without changing any caller.                            │
 * └─────────────────────────────────────────────────────────────────────┘
 */

export type ServiceType = 'transfer' | 'hourly';

/** Metres in one statute mile. */
const METRES_PER_MILE = 1609.344;

export function metersToMiles(meters: number): number {
  return meters / METRES_PER_MILE;
}

export interface PricingRules {
  transfer: {
    /** Floor for any transfer, however short. */
    minimumFarePence: number;
    /** Fixed component added before distance. */
    baseFarePence: number;
    /** Distance component. */
    perMilePence: number;
  };
  hourly: {
    hourlyRatePence: number;
    /** Shortest billable hire. */
    minimumHours: number;
  };
}

/** TODO: replace with the company's confirmed rate card. */
export const PLACEHOLDER_PRICING_RULES: PricingRules = {
  transfer: {
    minimumFarePence: 1500, // £15.00
    baseFarePence: 1000, // £10.00
    perMilePence: 220, // £2.20 / mile
  },
  hourly: {
    hourlyRatePence: 5000, // £50.00 / hour
    minimumHours: 2,
  },
};

export type QuoteInput =
  | { serviceType: 'transfer'; distanceMeters: number }
  | { serviceType: 'hourly'; hours: number };

export interface PriceQuote {
  amountPence: number;
  currency: 'GBP';
  /** Human-readable lines explaining how the amount was reached. */
  breakdown: string[];
  /** Always true for now — a suggestion, not a contractually agreed price. */
  isEstimate: true;
}

function poundsLabel(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function quoteTransfer(distanceMeters: number, rules: PricingRules): PriceQuote {
  const { minimumFarePence, baseFarePence, perMilePence } = rules.transfer;
  const miles = Math.max(0, metersToMiles(distanceMeters));
  const distancePence = Math.round(miles * perMilePence);
  const subtotal = baseFarePence + distancePence;
  const amountPence = Math.max(minimumFarePence, subtotal);

  const breakdown =
    amountPence === minimumFarePence && subtotal < minimumFarePence
      ? [`Minimum fare ${poundsLabel(minimumFarePence)}`]
      : [
          `Base ${poundsLabel(baseFarePence)}`,
          `${miles.toFixed(1)} mi × ${poundsLabel(perMilePence)}`,
        ];

  return { amountPence, currency: 'GBP', breakdown, isEstimate: true };
}

function quoteHourly(hours: number, rules: PricingRules): PriceQuote {
  const { hourlyRatePence, minimumHours } = rules.hourly;
  const billableHours = Math.max(minimumHours, Number.isFinite(hours) ? hours : 0);
  const amountPence = Math.round(billableHours * hourlyRatePence);
  return {
    amountPence,
    currency: 'GBP',
    breakdown: [`${billableHours} hr × ${poundsLabel(hourlyRatePence)}`],
    isEstimate: true,
  };
}

/** Suggest a contract price from a booking's measurable inputs. */
export function quoteBooking(input: QuoteInput, rules: PricingRules): PriceQuote {
  if (input.serviceType === 'hourly') {
    return quoteHourly(input.hours, rules);
  }
  return quoteTransfer(input.distanceMeters, rules);
}
