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
