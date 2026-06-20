import { bookingRef } from '@/lib/booking-ref';
import { formatLondonDateTimeShort, formatLondonTimeOfDay } from '@/lib/dates';
import type { Booking } from '@/server/db/schema';
import { SMS_BRAND_NAME } from './sms-templates';

/**
 * Exec-facing email templates. Unlike the terse SMS, these render a branded,
 * standardised layout — header → headline → details table → closing → footer —
 * as HTML with a plain-text fallback. Both exec emails (confirmation + en-route)
 * share one layout so they look consistent.
 *
 * SECURITY: every interpolated value (addresses, names, vehicle) is
 * operator/driver-entered, so it is HTML-escaped before going into the HTML
 * body. The plain-text body needs no escaping.
 */
type NamedDriver = { name: string };

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Layout {
  heading: string;
  intro: string;
  rows: { label: string; value: string }[];
  closing: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function passengerName(b: Booking): string {
  return [b.passengerFirstName, b.passengerLastName].filter(Boolean).join(' ').trim();
}

/** "4 hours" / "1 hour" / "1.5 hours" for an as-directed hire. */
function formatHireDuration(minutes: number): string {
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${Math.round(hours * 10) / 10} hours`;
}

function destination(b: Booking): string {
  if (b.serviceType === 'hourly')
    return `As directed — ${formatHireDuration(b.expectedDurationMinutes)}`;
  return b.dropoffAddress ?? 'As directed';
}

function renderText({ heading, intro, rows, closing }: Layout): string {
  const width = Math.max(...rows.map((r) => r.label.length));
  const lines = rows.map((r) => `  ${r.label.padEnd(width)}   ${r.value}`);
  return [
    SMS_BRAND_NAME,
    '',
    heading,
    '',
    intro,
    '',
    ...lines,
    '',
    closing,
    '',
    `${SMS_BRAND_NAME} · Automated booking notification`,
  ].join('\n');
}

function renderHtml({ heading, intro, rows, closing }: Layout): string {
  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:130px;vertical-align:top;">${escapeHtml(r.label)}</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;">${escapeHtml(r.value)}</td></tr>`,
    )
    .join('');
  const brand = escapeHtml(SMS_BRAND_NAME);
  return [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f4f5;padding:24px;">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">',
    `<div style="padding:18px 28px;border-bottom:3px solid #111827;"><span style="font-size:17px;font-weight:700;letter-spacing:.02em;color:#111827;">${brand}</span></div>`,
    '<div style="padding:26px 28px;">',
    `<h1 style="margin:0 0 14px;font-size:19px;font-weight:700;color:#111827;">${escapeHtml(heading)}</h1>`,
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#374151;">${escapeHtml(intro)}</p>`,
    `<table style="width:100%;border-collapse:collapse;border-top:1px solid #f0f0f1;border-bottom:1px solid #f0f0f1;">${rowsHtml}</table>`,
    `<p style="margin:22px 0 0;font-size:14px;line-height:1.5;color:#4b5563;">${escapeHtml(closing)}</p>`,
    '</div>',
    `<div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">${brand} · Automated booking notification</div>`,
    '</div></body></html>',
  ].join('');
}

/** Exec — booking confirmed once a driver accepts. */
export function assignedEmail(booking: Booking, driver: NamedDriver, car: string): RenderedEmail {
  const ref = bookingRef(booking.seq);
  const when = formatLondonDateTimeShort(booking.pickupAt);
  const layout: Layout = {
    heading: 'Booking confirmed',
    intro: 'Your chauffeur is booked and confirmed. The details are below.',
    rows: [
      { label: 'Reference', value: ref },
      { label: 'Passenger', value: passengerName(booking) },
      { label: 'Date & time', value: when },
      { label: 'Driver', value: driver.name },
      ...(car.trim() ? [{ label: 'Vehicle', value: car.trim() }] : []),
      { label: 'Pickup', value: booking.pickupAddress },
      { label: 'Destination', value: destination(booking) },
    ],
    closing:
      'Your driver will be in touch on arrival. To make any changes, please contact our team.',
  };
  return {
    subject: `Chauffeur confirmed — ${ref} · ${when}`,
    html: renderHtml(layout),
    text: renderText(layout),
  };
}

/** Exec — driver is on the way (clock fires ~1h before pickup). */
export function enRouteEmail(booking: Booking, driver: NamedDriver, car: string): RenderedEmail {
  const ref = bookingRef(booking.seq);
  const time = formatLondonTimeOfDay(booking.pickupAt);
  const layout: Layout = {
    heading: 'Your driver is on the way',
    intro: `Your driver ${driver.name} is now on the way for your ${time} pickup.`,
    rows: [
      { label: 'Reference', value: ref },
      { label: 'Passenger', value: passengerName(booking) },
      { label: 'Driver', value: driver.name },
      ...(car.trim() ? [{ label: 'Vehicle', value: car.trim() }] : []),
      { label: 'Pickup time', value: time },
      { label: 'Pickup', value: booking.pickupAddress },
    ],
    closing: 'They will meet you at the pickup point shortly. Safe travels.',
  };
  return {
    subject: `Your driver is on the way — ${ref} · ${time}`,
    html: renderHtml(layout),
    text: renderText(layout),
  };
}

/** Exec — their booking changed after confirmation; restate the current plan. */
export function changeExecEmail(booking: Booking): RenderedEmail {
  const ref = bookingRef(booking.seq);
  const when = formatLondonDateTimeShort(booking.pickupAt);
  const layout: Layout = {
    heading: 'Booking updated',
    intro: 'Your booking has been updated — the latest details are below.',
    rows: [
      { label: 'Reference', value: ref },
      { label: 'Passenger', value: passengerName(booking) },
      { label: 'Date & time', value: when },
      { label: 'Pickup', value: booking.pickupAddress },
      { label: 'Destination', value: destination(booking) },
    ],
    closing: 'If anything looks incorrect, please contact our team.',
  };
  return {
    subject: `Booking updated — ${ref} · ${when}`,
    html: renderHtml(layout),
    text: renderText(layout),
  };
}
