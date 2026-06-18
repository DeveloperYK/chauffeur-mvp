---
shaping: true
---

# Exec Messaging — Channels (Email + SMS) — Shaping

> **This doc supersedes the earlier SMS-only "Exec Messages" shape.** It absorbs the
> persistence + status-visibility + resend layer that was shaped before, and extends it to
> be **channel-aware**: the system can send each exec message by **SMS (Twilio, today) or
> email (Resend, new)**, chosen by a single backend switch. The visibility work (persist
> every attempt, tile/panel indicators, one-click resend) is now the shared foundation both
> channels ride on. Nothing about the SMS path is deleted.

---

## Source

> There should also be a display or a view of messages we have sent exec — that way the operator knows what the exec is aware of, and if there was a failure sending a message to exec it is clear. Not sure how we should go about this, we can discuss this in more detail.
>
> There should also be something on the booking tile if there was an error so the operator is aware there is an issue with that booking — they don't have to keep selecting every booking.

> We have automated SMS messaging for executives — the main issue with this is the cost. To solve this I want automated **emails** instead. I know from experience this is cheaper. I'd like a **toggle on the backend, like a flag**, that determines whether we do email or SMS — so we don't delete the SMS messaging. Also the operators should be able to see **when an email has been successfully sent** to the client; my concern is **silent failures** where the email isn't sent due to some error, so it's important any issue is propagated in a smooth way.

**Decisions captured from kickoff Q&A:**
- **Scope:** absorb & extend — one channel-aware effort; this supersedes the SMS-only doc.
- **Provider:** Resend (used via its REST API + manual Svix webhook verification — **no new npm dependency**, same `fetch` style as the Twilio adapter).
- **"Successfully sent":** true delivery via **provider webhooks** (delivered / bounced / failed), not just provider-accepted — this is what actually catches the silent failures.
- **Channel switch:** a single **code-level constant** (`EXEC_NOTIFICATION_CHANNEL`), flipped by editing code on request. Not runtime-configurable, no operator UI, no per-booking choice.

---

## Problem

We send the exec automated messages over the lifetime of a booking and **persist none of them**. `NotificationPort.sendSms` returns `{ok, id} | {ok:false, reason}` and every caller throws the result away. On top of that, **SMS is expensive**, and there is **no email channel** at all. So today:

- **Cost.** Every exec message is an SMS. Email is materially cheaper and we can't use it.
- **Silent loss.** When a send fails (bad number, account suspended, carrier rejected), nobody knows. The booking sits `assigned` and the exec was never told their driver's name.
- **No visibility.** Operators can't see what the exec has actually been told, and would have to open every booking detail panel to infer it — unworkable.
- **Email makes silence worse, not better, unless we design for it.** An email API returning `2xx` does **not** mean the message landed — it can bounce minutes later. "Accepted" is a false comfort. Without delivery webhooks, switching to email would *increase* silent failures.

This is the kind of silent failure that doesn't bite until it bites hard: an exec turns up at a meeting having had no confirmation, or doesn't know about a driver swap.

## Outcome

Operators can, at a glance:
1. See which bookings have a delivery problem with their exec (visible **on the board**, not just in the detail panel).
2. See the full timeline of what was sent to the exec for any one booking — **channel, status, and when** — including email **delivered / bounced** results that arrive after the fact.
3. Resend a failed/bounced message in one click without leaving the panel.

And under the hood: every exec message attempt is persisted (either channel), success or failure; the **active channel is a one-line code switch**; email delivery outcomes are confirmed by **webhook**, not assumed; and **SMS keeps working exactly as before**.

---

## CURRENT

🟡 **Three** automated exec send sites today (confirmed by grepping `sendSms` across `src/server/services`). PR #61 (ADR 0009) reworked reassignment into release-then-redispatch, so a replacement driver accepting via the normal dispatch link triggers the same `driver-accept` site. The released-driver `sendSms` in `dispatch.ts` goes to the *released driver* (not the exec) and is out of scope.

All fire through `NotificationPort.sendSms` and **discard the result**. Exec messages are entirely automated; operators never send one manually.

| Site | Trigger | Template | What the exec is told | Channel |
|---|---|---|---|---|
| `dispatch.ts` driver-accept | Driver taps Accept (initial or post-release replacement) | `assignedSms` | "Confirmed: \<time\> · Driver: \<name\> (\<car\>) · Pickup: …" | SMS only |
| 🟡 `backfill.ts` hand-to-backfill | Operator hands an unassigned job to a subcontractor | `assignedSms` | Same confirmation, naming the backfill driver + car | SMS only |
| `clock-tick.ts` en-route | Clock ticks 1h before pickup, state → in_progress (fires for both internal + backfill drivers) | `enRouteSms` | "Your driver \<name\> is on the way for your \<time\> pickup." | SMS only |

Other facts that shape the work:
- **Port:** `NotificationPort.sendSms({to, body}) → {ok, id} | {ok:false, reason}` (`src/server/ports/notifications.ts`). Twilio + Fake adapters; chosen in `composition.ts` by presence of Twilio env vars.
- **No persistence.** No table, no log, no UI. Failures invisible.
- **No email.** No `bookings.exec_email`, no exec/contact table (per-exec records are out-of-scope, DESIGN §12), no email provider in the stack.
- **No tile indicator.** Even if logged, operators would still click each booking to find problems.
- **Config pattern.** Env vars are Zod-validated in `src/lib/env.ts`; adapter wiring lives in `src/server/composition.ts`.
- **Clock sends are synchronous, no retry.** A failed send is silently swallowed.

---

## Requirements (R)

| ID | Requirement | Status |
|----|-------------|--------|
| R0 | A single backend switch decides whether exec messages go by **SMS or email, system-wide**; flipping it is a code change only, and **SMS remains fully functional** (not deleted) | Core goal |
| R1 | Email is sent via a real provider (**Resend**) behind a port, with the same Fake-double + contract-test treatment as SMS, and **without adding an npm dependency** | Must-have |
| R2 | **Every** exec message attempt (either channel) is persisted with channel, recipient, body, status, and provider response — no silent loss | Must-have |
| R3 | Email **true delivery** is tracked via provider webhooks — `delivered` / `bounced` / `failed` update the persisted record **asynchronously**, so a wrong or dead address surfaces as a failure rather than a false "sent" | Must-have |
| R4 | Operators see, per booking, the full **timeline** of what the exec was sent — channel, status (incl. delivered/bounced), when — and can tell "nothing sent yet" from "all delivered" | Must-have |
| R5 | The **board** shows a booking-level indicator when an exec message failed/bounced and hasn't been re-sent successfully — no need to open each booking | Must-have |
| R6 | Operator can **re-send** a failed/bounced message in one click; resend uses the active channel and rebuilds the body from current booking state | Must-have |
| R7 | The exec's **email address is captured** where the active channel needs it; if the active channel can't reach the exec (e.g. email mode but no email on file), it is surfaced as a **loud failure**, never silent | Must-have |
| **R8** | **Safety & fidelity** | Must-have |
| R8.1 | On the active channel, a successful send delivers the **same information** the exec gets today (behaviour-preserving) | Must-have |
| R8.2 | Persistence is **best-effort & decoupled**: a logging/DB failure must not break the send path, and a send failure must still be logged | Must-have |
| R8.3 | The webhook endpoint is **authenticated (signature-verified), idempotent, replay-resistant, and rate-limited**; verification is constant-time | Must-have |

---

## A: Channel-aware notification layer — switch + Resend email + delivery webhooks + shared visibility **(SELECTED)**

| Part | Mechanism | Flag |
|------|-----------|:----:|
| **A1** | **Channel switch + port split.** New code-level constant `EXEC_NOTIFICATION_CHANNEL: 'sms' \| 'email'` in a tiny config module (default `'sms'`; documented; changed by editing code). Keep `NotificationPort.sendSms`. Add a sibling `EmailPort.sendEmail({to, subject, text}) → {ok, id} \| {ok:false, reason}`. `composition.ts` wires **both** an SMS adapter and an Email adapter; the wrapper (A3) reads the constant to pick one. Falls back to Fakes in dev/test when creds absent, same as today. | |
| **A2** | **Resend email adapter + fake.** `ResendEmailAdapter` implements `EmailPort`: `POST https://api.resend.com/emails`, `Authorization: Bearer`, JSON `{from, to, subject, text}`, 10s timeout, returns Resend's `{id}`; error reasons mapped like the Twilio adapter (`http_4xx/5xx`, `timeout`, `network_error`, `invalid_to`, `empty_body`). Uses `fetch` only — **no SDK dep**. Sends an `Idempotency-Key` (the `exec_notifications.id`) so retries don't double-send. `FakeEmailAdapter` mirrors `FakeNotificationAdapter` (in-memory `sent[]`, `simulateFailure`, `reset`). New secrets in `env.ts`: `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_WEBHOOK_SECRET`. | |
| **A3** | **`exec_notifications` table + channel-aware wrapper.** Table: `id`, `booking_id` FK, `channel` enum(`sms`,`email`), `kind` enum(`assigned`,`en_route`), `to` (phone or email), `subject` (nullable; email only), `body`, `status` enum(`sent`,`delivered`,`failed`,`bounced`,`complained`,`superseded`), `provider_message_id` (nullable), `error_reason` (nullable), `created_at`, `updated_at`. Indexes: `(booking_id, created_at desc)` and partial on `status in ('failed','bounced','complained')`. Wrapper `sendExecNotification({db, sms, email, bookingId, kind, contact})`: reads the channel constant, renders that channel's template (A6), calls the right port wrapped in try/catch, **writes a row regardless of outcome**, and updates the cached column (A4) in the same tx. SMS rows are terminal at `sent`/`failed`; email rows start `sent` (accepted) and are later moved by the webhook (A8). | |
| **A4** | **Cached `bookings.exec_notification_status`.** Enum `none` \| `pending` \| `ok` \| `failed`, updated by the wrapper (A3), the webhook (A8) and resend (A9) inside their txns. Mapping: `none` = nothing sent; `pending` = email accepted, awaiting webhook; `ok` = SMS sent **or** email delivered; `failed` = any latest-per-kind row is `failed`/`bounced`/`complained`. Tiles read this column directly — no per-render query. The column↔rows invariant is contained in A3/A8/A9. | |
| **A5** | 🟡 **Replace the 3 exec call sites.** `dispatch.ts` driver-accept, `backfill.ts` hand-to-backfill (both `assigned`), and `clock-tick.ts` en-route (internal + backfill, both `en_route`) switch from `sendSms` to `sendExecNotification`. Behaviour-preserving on the active channel. The released-driver SMS in `dispatch.ts` stays unwrapped (not to the exec). | |
| **A6** | **Email templates (alongside the SMS ones).** `assignedEmail` / `enRouteEmail` produce `{subject, text}` mirroring the SMS content. Typed renderer; **text/plain only** (no user-controlled HTML — matches the "no user-controlled text in SMS" rule). SMS templates unchanged. | |
| **A7** | **Exec email capture + loud no-contact failure.** Add `bookings.exec_email` (nullable text, Zod-`email` validated, `.strict()`). The booking form requires the **active channel's** contact (mobile for SMS mode, email for email mode) and may optionally collect the other. If the wrapper is asked to send but the booking lacks the active channel's contact, it writes a `failed` row (`error_reason: 'no_email'` / `'no_mobile'`) → tile turns red → operator fixes + resends. Never silent. | |
| **A8** | **Resend delivery webhook.** Route `POST /api/webhooks/resend`. Verifies the Svix signature manually with `node:crypto`: `signedContent = ` `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 keyed by the base64-decoded secret (after `whsec_`), base64 output, **constant-time** compare against each `v1,<sig>` entry; reject if `svix-timestamp` is outside a tolerance window (replay). Maps `email.delivered → delivered`, `email.bounced → bounced`, `email.complained → complained`, `email.delivery_delayed → (no-op/log)`, correlating by `provider_message_id` = payload `email_id`. **Idempotent**: dedupe on `svix-id`; ignore unknown ids. Recomputes the cached column (A4). Per-IP/per-route rate limit like the other public routes. | |
| **A9** | **UI — tile + panel + drawer + resend.** Board tile: red dot/lozenge when `exec_notification_status='failed'` (tooltip "Exec didn't receive last message — open to resend"); subtle "pending" affordance optional. Detail panel: compact health indicator (✓ delivered / ⏳ pending / ⚠ failed-with-count); click opens a drawer listing each message — **channel icon (📱/✉️)**, kind, status, timestamp, error reason, and a `Resend` button on failed/bounced. `resendExecNotification(id)`: rebuilds the body from **current** booking+driver state, sends via the **active** channel, writes a new row, marks the old one `superseded`; on success/delivery with no other outstanding failures, flips the cached column back to `ok` (auto-clear). | |
| **A10** | **Tests.** Integration: wrapper (SMS→`sent`+`ok`; email→`sent`+`pending`; port `ok:false`→`failed`; thrown exception→`failed`; missing contact→`failed`+reason). Webhook: `delivered` flips `pending→ok`; `bounced` flips `→failed`; bad signature rejected; replay/stale timestamp rejected; duplicate `svix-id` no-ops. Channel switch: constant routes wrapper to the right port. Form: channel-aware required field. Email `EmailPort` contract test (fake + real shape). Lifecycle e2e extended: bounced exec email shows the indicator, resend clears it. Full unit+integration suite stays **< 60s**. | |

---

## Status model (how an exec message moves)

```
SMS  (sync, no webhook — same as today)
  send → ok:true  ⇒ row 'sent'     ⇒ booking 'ok'
       → ok:false ⇒ row 'failed'   ⇒ booking 'failed'

EMAIL (async, webhook-confirmed)
  send → ok:true  ⇒ row 'sent'     ⇒ booking 'pending'
            └─ webhook email.delivered  ⇒ row 'delivered'  ⇒ booking 'ok'
            └─ webhook email.bounced    ⇒ row 'bounced'    ⇒ booking 'failed'
            └─ webhook email.complained ⇒ row 'complained' ⇒ booking 'failed'
       → ok:false ⇒ row 'failed'   ⇒ booking 'failed'   (provider rejected at send)
  no exec_email on file ⇒ row 'failed' (no_email) ⇒ booking 'failed'

RESEND (either channel) ⇒ new row; old failed/bounced row → 'superseded';
  cached column recomputed from latest-per-kind.
```

Asymmetry by design: SMS has no delivery webhook, so its best signal is "accepted" (`sent → ok`), unchanged from today. Email gets **true** delivery confirmation. Since the whole point is to move exec traffic to the cheaper email channel, that's where the delivery rigour is spent.

---

## Fit Check: R × A (selected)

| Req | Requirement | Status | A |
|-----|-------------|--------|:-:|
| R0 | Single backend switch (SMS \| email), code-only flip, SMS not deleted | Core goal | ✅ |
| R1 | Email via Resend behind a port, fake + contract tests, no new dep | Must-have | ✅ |
| R2 | Every attempt persisted (either channel), no silent loss | Must-have | ✅ |
| R3 | Email true-delivery via webhooks updates status async | Must-have | ✅ |
| R4 | Per-booking timeline: channel, status, when; "none" vs "delivered" | Must-have | ✅ |
| R5 | Board-level failure indicator | Must-have | ✅ |
| R6 | One-click resend on active channel, rebuilt from current state | Must-have | ✅ |
| R7 | Exec email captured; unreachable exec is a loud failure | Must-have | ✅ |
| R8.1 | Behaviour-preserving on success | Must-have | ✅ |
| R8.2 | Best-effort persistence can't break send; send failure still logged | Must-have | ✅ |
| R8.3 | Webhook authenticated, idempotent, replay-resistant, rate-limited, constant-time | Must-have | ✅ |

No flagged unknowns: the Resend send API (`POST /emails` → `{id}`) and the Svix webhook signature scheme (HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${body}`, constant-time compare) were both verified against vendor docs during shaping, and both are implementable with `fetch` + `node:crypto`.

---

## Alternatives considered (rejected at kickoff)

| Fork | Chosen | Rejected — why |
|---|---|---|
| Scope | Absorb & extend into one channel-aware layer | Two separate docs/efforts would duplicate the persistence + visibility + resend shape, which both channels need identically. |
| Provider | Resend | SES (cheapest at scale) carries heavier setup (IAM, SNS, domain verification) than the MVP needs; SendGrid keeps one vendor but a heavier API; SMTP/nodemailer pushes deliverability + bounce handling onto us. Resend gives first-class delivery webhooks with a trivial REST surface. |
| Delivery proof | True delivery via webhooks | Provider-accepted-only would show "sent" for an address that silently bounces — the exact failure mode the user is worried about. |
| Toggle scope | Global, code-level constant | Per-booking operator choice adds per-record state + UI the user explicitly didn't want; email-with-SMS-fallback adds routing logic not asked for (can revisit later as a follow-up if cost demands it). |

---

## Decisions locked

1. ✅ **Channel switch** — single code-level `EXEC_NOTIFICATION_CHANNEL` constant, default `sms`, flipped by editing code. No runtime config, no operator UI.
2. ✅ **Provider** — Resend via REST + manual Svix verification; **no npm dependency added**.
3. ✅ **"Sent" = delivered** for email, confirmed by webhook; SMS stays accepted-only (unchanged).
4. ✅ **No fallback** — global flag only; an unreachable exec on the active channel is a loud `failed` row, surfaced on the tile.
5. ✅ **Persistence layer is channel-aware from day one** — `exec_notifications.channel`, shared tile/panel/drawer/resend across both channels.
6. ✅ **Email body** — text/plain, no user-controlled HTML (same safety posture as SMS).
7. ✅ **Retention** — rows kept forever in the MVP; no purge job.
8. ✅ **Resend** — rebuild from current state, send on active channel, supersede the old row, auto-clear the tile on success/delivery.
9. ✅ **`exec_email` field + clean DB.** `bookings.exec_email` is a required field of the booking form when in email mode. The current DB will be **cleared** when this ships, so there is no legacy SMS-mode data missing an email — no backfill/migration concern. (Column stays nullable at the schema level so SMS-mode bookings need not carry one.)
10. ✅ **From-address for testing.** Test against one of the user's own emails first; the company business address is configured later once provided. **Caveat (see below):** Resend can't send *from* an arbitrary personal address without domain verification — the test path uses `onboarding@resend.dev` as the FROM and the user's email as the recipient.
11. ✅ **"pending" is panel-only.** The board tile stays binary (`ok`/`failed`); an email that's accepted-but-not-yet-delivered shows as `pending` **only in the detail panel**, to keep the board free of transient amber noise.
12. ✅ **Webhook replay window = 5 min.** Reject any webhook whose `svix-timestamp` is more than 5 minutes from server time.

---

## Resend sending constraint (ops note, not code)

Resend will not let us send **from** an arbitrary personal address (e.g. a hotmail/gmail) — the sending domain must be verified (SPF/DKIM) in the Resend dashboard. Two practical phases:

- **Testing now:** `RESEND_FROM = onboarding@resend.dev` (Resend's no-verification sandbox sender). In sandbox you can only send to the **account-owner's email**, so set the test booking's `exec_email` to the user's own email. Resend also provides deterministic recipient addresses — `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev` — that fire the matching webhook events, which V3 / A10 use to test the delivery state machine without real bounces.
- **Production later:** the company verifies its business domain in Resend, then `RESEND_FROM` becomes `something@<their-domain>` and arbitrary exec recipients work. This is an ops prerequisite for go-live on email, gated behind the channel switch staying `sms` until it's done.

---

## Open questions (to confirm before slicing)

None — all resolved (see Decisions locked, items 9–12). The only remaining items are **ops prerequisites**, not shaping decisions: a verified Resend sending domain for production, and the `RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` env values.

---

## Next

Doc is slice-ready. Next: write `docs/shaping/exec-messages/slices.md` (use `/breadboarding`), proposed slicing:

- **V1 — Persistence + visibility on SMS (no email yet).** `exec_notifications` table, wrapper, cached column, replace the 2 sites, tile + panel + drawer + resend, tests. Ships value immediately and de-risks the shared layer while channel stays `sms`. *(This is the old SMS-only shape, now built as the channel-aware foundation with `channel='sms'`.)*
- **V2 — Email channel + switch.** `EmailPort`, Resend + Fake adapters, email templates, `exec_email` field + channel-aware form, flip-by-constant. Sends accepted-only (`pending`) until V3.
- **V3 — Delivery webhooks.** `/api/webhooks/resend`, signature verify, status transitions, board/panel reflect delivered/bounced. Closes the true-delivery loop.
