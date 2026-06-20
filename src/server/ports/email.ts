export interface EmailMessage {
  to: string; // recipient email address
  subject: string;
  text: string; // plain-text fallback (always sent)
  html?: string; // optional branded HTML body; interpolated values must be escaped by the renderer
}

export interface EmailPort {
  sendEmail(msg: EmailMessage): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
}
