export interface SmsMessage {
  to: string; // E.164
  body: string;
}

export interface NotificationPort {
  sendSms(msg: SmsMessage): Promise<{ ok: true; id: string } | { ok: false; reason: string }>;
}
