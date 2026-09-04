# Production Environment Build Plan

> Status: **planning / in progress**. Owner: Yousuf. Created 2026-06-24.
> Goal: stand up a proper, isolated **production** environment for go-live and
> relabel the current "live" environment as **pre-prod / staging** — both hosted
> in the UK/EU. Target load: **100–200 bookings/day** (capacity is a non-issue at
> this volume; this work is about isolation, data safety, recoverability, and a
> clean cutover).

---

## 1. Principles

- **Hard isolation.** Prod and pre-prod share *nothing* — separate database,
  secrets, domains, crons, and third-party keys. A staging mistake can never
  touch production.
- **Clean production.** Production is built new and empty. No test data, no
  previously-exposed secrets, and no destructive simulator carried over.
- **Data residency.** UK exec/customer PII lives in the EU (London) — the
  appropriate posture for a UK business handling personal data.
- **Pre-prod first.** Stabilise and regionalise the existing environment as a
  proper UK staging stack, prove it works end-to-end, *then* stamp out
  production from that proven base.
- **Recoverable.** Every state change is already audit-logged; add backups and
  observability before real data flows.

## 2. Current state (as-is, 2026-06-24)

| Resource | Current |
|---|---|
| Vercel | One project `chauffeur-mvp` (`prj_yJVuItSRMj3BYgIs8BU8RDx6xLAq`), **Pro**, Node 24, deploys from `main`, functions in **iad1 (US-East)** |
| Domain | `chauffeur-mvp.vercel.app` (no custom domain) |
| Database | Supabase `chauffeur-mvp` (`lbpbrhjbbuxuukgylrro`), **us-east-1**, **Free** org `AITrust-Platform`. Runtime = transaction pooler `:6543` (`prepare:false`); migrations = session pooler `:5432` |
| Clock loop | Vercel Cron `* * * * *` → `GET /api/clock-tick`, authed by `CRON_SECRET` |
| Email | Resend, live, domain `groundwork-ltd.co.uk` + delivery webhook |
| Sheets mirror | Google Sheets backup (PR #90) — prod creds not yet set |
| Other | Google Places key; Twilio (trial, UK SMS blocked) |
| Config flags | `AUTH_DISABLED=true`, `SIMULATOR_ENABLED=true` — **unacceptable for production** |
| Secrets | `DRIVER_LINK_SECRET`, `CRON_SECRET`, DB password — some **flagged exposed** in a past session transcript; must be rotated |

The current env has accumulated test data, destructive-simulator access, and
exposed secrets — which is exactly why production is built fresh rather than by
relabelling this one.

## 3. Target architecture (to-be)

Two fully-isolated Vercel projects on the same Pro team (no extra cost), code
promoted **staging → prod**. Both stacks hosted in the **UK/EU**.

| | **Production (new)** | **Pre-prod / Staging (existing, migrated)** |
|---|---|---|
| Vercel project | `chauffeur-prod` (new) | `chauffeur-mvp` → renamed `chauffeur-staging` |
| Production Branch | `main` | `staging` (new branch) |
| Function region | **London `lhr1`** | **London `lhr1`** (moved from iad1) |
| Supabase project | new, **eu-west-2 (London)**, clean | new, **eu-west-2 (London)**, data migrated from old us-east-1 |
| Domain | new `*.vercel.app` now → custom domain later | staging `*.vercel.app` |
| `AUTH_DISABLED` | **false** (real login) | `true` (convenience) |
| `SIMULATOR_ENABLED` | **unset/false** | `true` (testing) |
| Secrets | fresh, unique, never reused | rotated copies |
| Backups | daily `pg_dump` (interim) + Sheets mirror | not required |

## 4. Region & data-residency notes

- A Supabase project's region **cannot be changed in place** — moving to the UK
  means creating a new **eu-west-2** project and migrating data into it.
- Vercel function region is just a project setting (Settings → Functions →
  Region = London `lhr1`); it applies to new deployments, so a redeploy is
  required after changing it.
- Keeping functions and DB **co-located in London** preserves the
  low-latency function↔DB path while also putting data near the UK operators and
  in-region for data protection.

## 5. Supabase Free-tier project-slot juggling

Free orgs allow **2 active projects**. The sequence never exceeds 2:

1. Start: 1 project (old us-east-1 staging).
2. Create UK-staging → 2 projects. ✅
3. Migrate data + verify → delete old us-east-1 → 1 project. ✅
4. Create UK-prod → 2 projects. ✅

Doing **pre-prod first** is what makes this clean.

---

## 6. Execution plan

### Stage A — Migrate & regionalise pre-prod to the UK (do this first)

**A1. New UK staging database**
- [ ] Create Supabase project **`chauffeur-staging`** in **eu-west-2 (London)**,
      Data API **disabled** (direct Postgres only — avoids exposing PII tables).
- [ ] Record session (`:5432`) + transaction (`:6543`) pooler URLs + DB password
      into a new gitignored `.env.staging`.
- [ ] Set Supabase connection pool size to 30 (burst headroom), as today.

**A2. Migrate existing data**
- [ ] `pg_dump` the current us-east-1 DB (data + schema).
- [ ] Restore into the new UK staging DB.
- [ ] Sanity-check row counts (bookings, drivers, operators, audit_events).

**A3. Repoint the existing Vercel project to UK**
- [ ] Rename project `chauffeur-mvp` → `chauffeur-staging`.
- [ ] **Pin Functions region → London `lhr1`.**
- [ ] Update env vars: `DATABASE_URL` (UK `:6543`), `MIGRATE_DATABASE_URL`
      (UK `:5432`), `APP_URL` (staging URL).
- [ ] Redeploy; verify `/api/healthz`, `/dashboard`, a full booking lifecycle,
      cron tick (200), and email delivery against the UK DB.

**A4. Branch & promotion model (see §7)**
- [ ] Create `staging` branch from `main`.
- [ ] Switch the staging project's **Production Branch** to `staging`.
- [ ] Add an **Ignored Build Step** so it only builds `staging` (+ its PRs) —
      prevents cross-project preview noise once two projects share one repo.

**A5. Secrets hygiene**
- [ ] Rotate the previously-exposed secrets (DB password, `DRIVER_LINK_SECRET`,
      `CRON_SECRET`) for staging.

**A6. Decommission old region**
- [ ] Once UK staging is verified, **delete the old us-east-1 Supabase project**
      (frees the Free-tier slot for prod).

### Stage B — Build production in the UK (clean)

**B1. Production database**
- [ ] Create Supabase project **`chauffeur-prod`** in **eu-west-2**, Data API
      disabled, clean/empty. Pooler URLs + password → gitignored `.env.prod`.
- [ ] Run migrations against the prod session pooler.
- [ ] Seed the **4 real operators** via `scripts/create-operator.ts`
      (passwords ≥ 12 chars). No public signup.

**B2. Production Vercel project**
- [ ] Create `chauffeur-prod`, link repo, Production Branch = `main`, Node 24,
      Functions region **London `lhr1`**, Ignored Build Step scoped to `main`.
- [ ] Env (Production scope): `DATABASE_URL` (prod `:6543`, `prepare:false`),
      `MIGRATE_DATABASE_URL` (prod `:5432`), **fresh** `DRIVER_LINK_SECRET`,
      **fresh** `CRON_SECRET`, `APP_URL` (prod URL), `AUTH_DISABLED=false`,
      `SIMULATOR_ENABLED` unset, `NODE_ENV=production`.
- [ ] Vercel Cron `* * * * *` → `/api/clock-tick` (carried in `vercel.json`).

**B3. Third-party production resources** (separate per environment)
- [ ] **Resend**: separate prod API key + prod webhook endpoint.
      ⚠️ **Volume:** at ~200 bookings/day you exceed Resend's free tier
      (100/day, 3k/mo). Budget for **Resend paid (~$20/mo, 50k)** at go-live.
- [ ] **Google Sheets**: separate prod spreadsheet + service account (don't
      co-mingle real bookings into the test sheet). Completes PR #90 for prod.
- [ ] **Google Places**: separate prod key, domain-restricted.
- [ ] **Sentry** (PR #91): one project, `SENTRY_ENVIRONMENT=production` vs
      `staging`; DSN set in both Vercel projects.
- [ ] **Twilio**: SMS is email-first today; if SMS goes live it needs the
      upgraded (non-trial) account. Not blocking.

**B4. Hardening**
- [ ] All-fresh prod secrets; never reuse staging's.
- [ ] Confirm real login works; confirm the simulator route 404s in prod.
- [ ] Deployment Protection stays **off** (required so public signed driver
      links + cron work) — security rests on app auth + signed JWTs, by design.

**B5. Backups & observability**
- [ ] Free tier has **no PITR/backups** → add a **daily `pg_dump`** (e.g. a
      scheduled GitHub Action, encrypted artifact) as the interim safety net;
      the Sheets mirror is a human-readable secondary copy.
      ⚠️ **Upgrade to Supabase Pro ($25/mo, 7-day PITR) before real volume
      builds** — a Free-tier data-loss event is unrecoverable.
- [ ] Uptime monitor on prod `/api/healthz` + clock-tick heartbeat → Discord.

**B6. Cutover (low-risk — no real customers yet)**
- [ ] Smoke-test prod: healthz, login, create → dispatch → complete one booking,
      driver link, cron tick, email delivery.
- [ ] Operators switch to the prod URL on go-live day. No data migration.

---

## 7. CI/CD & promotion model

**Decided model: `main` is the integration branch; `production` is the release
branch.** This preserves the existing "branch off `main`, PR into `main`"
workflow (and the worktree process) unchanged.

- `main` → auto-deploys **chauffeur-staging** (London). Every merged PR lands on
  staging.
- `production` → auto-deploys **chauffeur-prod** (London; created in Stage B).
- **Promotion is manual and gated:** open a `main → production` PR; it merges
  only when CI is green and the lifecycle-E2E gate passes. Prod releases are
  deliberate.

**Continuous integration (unchanged):** `.github/workflows/ci.yml` runs on
push/PR — `Typecheck · Lint · Test` (<60s), `E2E smoke`, `E2E lifecycle`, build,
audit.

**Branch protection (live):**
- `main`: PR required, `Typecheck · Lint · Test` must be green, no
  force-push/deletion.
- `production`: same now; the lifecycle-E2E-vs-staging gate is added as a
  required check in Stage B.

**Migrations:** each project migrates its own DB on its production deploy
(`decideDeployMigration` gates on `VERCEL_ENV=production`). The staging project's
`main` deploy migrates the staging DB; the prod project's `production` deploy
migrates the prod DB. Migrations stay backward-compatible so a code rollback
never breaks against a newer schema.

**Rollback:** Vercel Instant Rollback to the previous prod deployment.

**Stage B wiring (when the prod project exists):**
- Prod project Production Branch = `production`, region `lhr1`, env + fresh secrets.
- Per-project **Ignored Build Steps** (staging builds `main` + its PRs; prod
  builds only `production`) to avoid cross-project preview noise.
- Purpose-built **promotion-gate workflow**: lifecycle E2E against the staging
  URL on `production` PRs → required check.
- PR previews (into `main`) point at the staging DB.

## 8. Secrets to generate fresh for prod (and rotate where exposed)

`DRIVER_LINK_SECRET` · `CRON_SECRET` · Supabase DB password · Resend prod API key
· Google service-account key · Sentry DSN/token. Stored Vercel-Sensitive +
gitignored local `.env.prod` / `.env.staging`.

## 9. Cost summary

| Item | Cost | Note |
|---|---|---|
| Vercel | $0 extra | Two projects on the existing Pro team |
| Supabase | $0 (Free, chosen) | Plan for **$25/mo Pro** (PITR) before volume grows |
| Resend | ~**$20/mo** | Needed at go-live email volume (free tier too small) |
| Sentry | $0 | Free tier sufficient |
| Domain | $0 | `vercel.app` for now; custom domain later |

## 10. Top risks

1. **Free-tier data loss** (no PITR) — mitigated by daily dumps + Sheets mirror;
   real fix is Supabase Pro.
2. **Resend free-tier cap** silently dropping exec emails at volume — fix before
   launch.
3. **Two-projects-one-repo** cross-previews — fixed by per-project Ignored Build
   Steps.
4. **Stale/exposed secrets** carried into prod — fixed by fresh-generate +
   rotation.
5. **Data migration during the UK move** — low risk (staging/test data only, no
   live customers), but verify row counts after restore.

## 11. Open items / later

- Custom production domain (subdomain of `groundwork-ltd.co.uk`) once chosen.
- Supabase Pro upgrade (PITR) — before sustained real volume.
- Resend paid plan — before go-live.
- Twilio non-trial — if/when SMS notifications go live.
- Finalise CI/CD promotion specifics (auto vs manual, E2E gate) at Stage A4.
