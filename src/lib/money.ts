/**
 * Parse an optional pounds form field ("165", "82.50") into pence.
 *
 * Blank or absent means the operator left the price out — returns null, which
 * the booking schemas accept as "not agreed yet". A non-numeric value returns
 * NaN so Zod rejects it loudly instead of it silently becoming null or 0.
 */
export function parsePoundsFieldToPence(raw: FormDataEntryValue | null): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const pounds = Number.parseFloat(String(raw));
  return Number.isFinite(pounds) ? Math.round(pounds * 100) : Number.NaN;
}

/**
 * Render a stored pence amount as the value of a pounds input ("25000" → "250",
 * "12550" → "125.5"). Blank when there is nothing to pre-fill (null, zero or
 * negative), so the field simply starts empty.
 */
export function penceToPoundsInput(pence: number | null | undefined): string {
  if (pence == null || !Number.isFinite(pence) || pence <= 0) return '';
  return String(pence / 100);
}
