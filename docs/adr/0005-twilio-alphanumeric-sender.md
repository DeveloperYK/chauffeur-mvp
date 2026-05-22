# 0005 — Twilio alphanumeric Sender ID support

**Status:** Accepted
**Date:** 2026-05-22

## Context

The operators are UK-based and SMS goes to UK mobiles. During Twilio setup we
hit two hard limits:

- A US long code cannot deliver SMS to UK numbers (Twilio error 21612).
- Trial accounts cannot use an Alphanumeric Sender ID at all (error 21267).

For production UK notification traffic the correct sender is an **Alphanumeric
Sender ID** (e.g. `Chauffeur`): it is one-way (no inbound replies needed for our
dispatch notifications), requires no purchased number, and surfaces the brand
name directly — satisfying the "make it clearly from the chauffeur company"
requirement. It needs an **upgraded** (paid) Twilio account, and for reliable
UK delivery the Sender ID should be registered with the UK Sender ID Registry.

`TwilioNotificationAdapter` previously required the `from` value to be E.164
(`startsWith('+')`), which would reject an alphanumeric Sender ID.

## Decision

- Add `isValidTwilioSender(from)` allowing **either** an E.164 number
  (`^\+[1-9]\d{6,14}$`) **or** an alphanumeric Sender ID
  (`^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$` — 1–11 chars, ≥1 letter).
- The adapter constructor validates with it; everything else (recipient must be
  E.164, body limits, request shape) is unchanged.
- `TWILIO_FROM_NUMBER` may now hold `Chauffeur` (or a `+…` number).

## Consequences

- The app is ready to send via an alphanumeric Sender ID the moment the Twilio
  account is upgraded — no further code change.
- All-numeric senders without a `+` are still rejected (ambiguous; not a valid
  E.164 nor a valid alphanumeric Sender ID).
- Live UK SMS testing is deferred until the Twilio account is upgraded; on the
  current trial the integration is fully wired but UK sends are blocked by
  Twilio policy, not by our code.

## Follow-ups (production, post-upgrade)

- Upgrade Twilio (payment method); set `TWILIO_FROM_NUMBER=Chauffeur` in Vercel.
- Register the `Chauffeur` Sender ID for the UK.
- Re-run the live SMS test to a real handset.
