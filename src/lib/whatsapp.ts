/**
 * Build a WhatsApp Web "send" deep link.
 *
 * We deliberately target `web.whatsapp.com/send` rather than `wa.me/…`:
 * `wa.me` bounces through a "Continue to chat" interstitial and may try to
 * launch the desktop app, which can spawn a second session. `web.whatsapp.com`
 * reuses the operator's already-open WhatsApp Web tab, loads the contact, and
 * pre-fills the message so all they have to do is press send.
 *
 * The number is reduced to digits only (country code first, no `+`, no spaces)
 * as WhatsApp requires; the message body is URL-encoded.
 */
export function whatsappWebLink(number: string, text: string): string {
  const phone = number.replace(/\D/g, '');
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(text)}`;
}

/**
 * The phone-side equivalent: `wa.me` hands straight to the installed WhatsApp
 * app, which is what an operator on a mobile wants (the Web deep link above
 * would open a browser tab instead).
 */
export function whatsappMobileLink(number: string, text: string): string {
  const phone = number.replace(/\D/g, '');
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * Turn a link built by `whatsappWebLink` into its `wa.me` form for an operator
 * on a phone, where WhatsApp Web does not run and `wa.me` hands straight to
 * the app. Links are minted on the server without knowing the device, so the
 * client rewrites them at render time (see components/console/whatsapp-link).
 * Anything that is not a WhatsApp Web send link is returned untouched.
 */
export function whatsappLinkForPhone(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'web.whatsapp.com') return href;
  if (url.pathname !== '/send' || url.username || url.password) return href;
  const phone = (url.searchParams.get('phone') ?? '').replace(/\D/g, '');
  if (!phone) return href;
  return whatsappMobileLink(phone, url.searchParams.get('text') ?? '');
}
