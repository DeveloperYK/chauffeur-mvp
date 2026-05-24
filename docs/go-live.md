# Go-live (v1) — costs & readiness

What it takes to run the Chauffeur dispatch platform in production with real
traffic. Profile: **~100–200 bookings/day**, 4 operators, ~£80k/week turnover.
In infra terms this is tiny — the only cost that scales with bookings is **SMS**.

**Messaging decision (v1):** all notifications are sent **automatically by SMS**
— both driver dispatch/completion links and exec "confirmed"/"en route". (The
driver auto-SMS work is tracked in issue #40; today driver links are still sent
by hand over WhatsApp.)

---

## 💷 Monthly running costs (estimates)

| Item | Service | Plan | Est. £/mo |
|---|---|---|---|
| Hosting / CDN / serverless | Vercel | Pro | £15–30 |
| Database + backups + pooling | Supabase | Pro | £20 |
| **Text messages (automated)** | Twilio | pay-as-you-go | **£600–1,400** ⟵ main cost |
| Error + uptime monitoring | Sentry / Better Stack | free → paid | £0–40 |
| Address lookup (if used) | Google Maps Places | pay-as-you-go | £0–50 |
| Domain | registrar | — | ~£1 |
| Legacy "JJ DATA" sync | Google Sheets API | free | £0 |

- **Everything except SMS:** ~£60–120/mo
- **All-in:** **~£700–1,500/mo**, almost entirely SMS.

### The SMS math
~3–4 SMS per booking — driver dispatch link (+ completion link) and exec
"confirmed" + "en route".

- 150 bookings/day ≈ 16k SMS/mo ≈ **£700/mo**
- 200 bookings/day ≈ 27k SMS/mo ≈ **£1,200/mo**

Driver auto-SMS adds ~£300–500/mo vs sending them by hand over WhatsApp, but
removes the operator clicking 100–200 messages/day. SMS is universal (every
phone, no app) and audit-logged.

> **Future cost optimisation (not v1):** moving exec notifications to the
> WhatsApp Business API is ~half the per-message cost, but adds Meta business
> verification, pre-approved message templates, stricter opt-in rules, and an
> app-installed requirement. Only worth it if the SMS bill grows or execs ask
> for it.

One-offs: domain (~£12/yr), branded SMS sender registration, setup time.

---

## ✅ Go-live readiness — the real blockers (mostly not cost)

### 🔴 Access & security (must-do before real traffic)
- **Disable the dev auth bypass in production.** Outside production,
  `currentSession()` logs any visitor in as the first operator. Production must
  run `NODE_ENV=production` with `AUTH_DISABLED` unset and real operator accounts
  (Argon2, ≥12 chars).
- **Remove Vercel Deployment Protection** on the production domain. The site
  currently 401s behind Vercel's SSO wall — operators can't reach the login, and
  critically **drivers can't open the public `/j/[token]` links on their phones.**
  The driver-link path must be public.
- **Confirm `SIMULATOR_ENABLED` is OFF in production** (it has a destructive
  "Reset all data").

### 🟠 Messaging (Twilio)
- Move **off the Twilio trial** (trial only texts pre-verified numbers and
  prefixes the body). Fund a paid account.
- Register the **UK alphanumeric sender ID** ("Chauffeur").
- Build **automated driver dispatch/completion SMS** (issue #40) — currently a
  manual WhatsApp send.

### 🟠 Data & compliance (UK GDPR — names, mobiles, addresses)
- Privacy policy + lawful basis + data-retention/deletion policy.
- DPAs with Vercel, Supabase, Twilio, Google.
- Pin Supabase + Vercel to a **London / eu-west** region.
- Verify PII log-redaction is active in production.

### 🟡 Reliability / ops
- **Backups:** Supabase Pro daily backups — run a restore drill once.
- **Monitoring:** error tracking (Sentry) + uptime alerts to a **phone**.
- **Clock-tick:** the heartbeat that transitions bookings — monitor it and alert
  if it stops. Migrations now auto-run on deploy (PR #38); keep
  `MIGRATE_DATABASE_URL` (Supabase session pooler) set in Vercel Production.

### 🟢 Pre-launch verification
- Run `pnpm test:e2e:lifecycle` against a staging deploy.
- One real end-to-end smoke on an actual phone: create → dispatch → driver
  accepts via link → exec gets the "en route" SMS → completion → approve.

---

**Bottom line:** cost is small vs turnover (~£700–1,500/mo, almost all SMS). The
real go-live work is the **access/security hardening** and **basic ops**, not the
money.
