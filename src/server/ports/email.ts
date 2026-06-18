export interface EmailMessage {
  to: string; // recipient email address
  subject: string;
  text: string; // plain-text body (no user-controlled HTML — same safety posture as SMS)
}

export interface EmailPort {
  sendEmail(msg: EmailMessage): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
}
