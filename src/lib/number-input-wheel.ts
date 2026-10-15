/**
 * Browsers treat a wheel/trackpad scroll over a focused `<input type="number">`
 * as a request to step the value. On a form the operator is scrolling through
 * that silently edits the price, waiting time or car park figure. The guard
 * blurs the input instead, so the scroll goes to the page and the value stays.
 *
 * Pure decision helper so the rule is unit-testable without a DOM; the
 * `NumberInputWheelGuard` component wires it to the document.
 */

/** The slice of an element the guard inspects (mirrors HTMLInputElement). */
export type WheelTarget = { tagName: string; type: string; blur: () => void };

const isNumberInput = (el: unknown): el is WheelTarget =>
  typeof el === 'object' &&
  el !== null &&
  (el as WheelTarget).tagName === 'INPUT' &&
  (el as WheelTarget).type === 'number';

/**
 * Returns the input to blur for a wheel event, or null when the event should
 * be left alone: only a number input that is both focused and under the
 * pointer steps its value on scroll.
 */
export function wheelTargetToBlur(target: unknown, activeElement: unknown): WheelTarget | null {
  if (!isNumberInput(target)) return null;
  return target === activeElement ? target : null;
}
