# CLAUDE.md — Chauffeur Dispatch Platform

This file is read by Claude Code at session start and treated as the binding rules of engagement for this repository. **Follow it exactly.** When in doubt, ask before deviating.

---

## 1. Project context

This is a production-grade dispatch platform for a chauffeur company turning over ~£70k/week. The design package is in this folder (`DESIGN.md`, `EXECUTIVE-SUMMARY.md`, `OPEN-QUESTIONS.md`, `diagrams/`). The build follows that design exactly. Do not invent new features or scope. If a feature isn't in the design, do not build it without asking.

**Audience for the system:** four operators at the chauffeur company. Their livelihood depends on this not breaking. Treat every line as production code.

---

## 2. Engineering bar — Principal-level

Every change must clear this bar before merge:

- **Correctness first.** Code does what the design says. No more, no less.
- **TDD always.** Tests written first, failing, then code makes them pass. No exceptions for "small" changes.
- **Security by default.** See §6.
- **Observable in production.** Structured logs, error context, audit trail for every state change.
- **Reversible deploys.** Migrations are backward-compatible. Feature flags for risky changes.
- **No half-builds.** Don't merge work that compiles but doesn't work end-to-end. Either ship a vertical slice or don't open the PR.
- **Documented decisions.** Non-obvious choices get a short ADR (`docs/adr/NNNN-title.md`).

---

## 3. Tech stack (locked)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict mode, no `any`) | `tsconfig.json` strict + `noUncheckedIndexedAccess` |
| Runtime | Node.js 20 LTS | pinned in `.nvmrc` and `package.json` engines |
| Framework | Next.js 15 (App Router) | server actions for operator dashboard mutations; Route Handlers for public driver-link API |
| Database | PostgreSQL 16 | local via Docker Compose; production TBD (Neon / Supabase / RDS) |
| ORM | Drizzle ORM | migrations in SQL, generated and reviewed manually |
| Auth | Lucia v3 | session-based, operator-only login |
| SMS | Twilio (or stub in dev/test) | provider behind a `NotificationPort` interface |
| Sheets mirror | `googleapis` (Google Sheets API v4) | behind a `SpreadsheetMirrorPort` interface |
| Validation | Zod | every API boundary, every form |
| UI | React 19 + Tailwind CSS + shadcn/ui | accessible by default |
| Test runner | Vitest | unit + integration, **total suite < 60s** |
| E2E | Playwright | smoke flow only in CI |
| Lint/format | Biome | enforced in pre-commit hook |
| Package mgr | pnpm | lockfile committed |
| CI | GitHub Actions | typecheck → lint → test → e2e → build |

**Do not introduce libraries not in this list** without raising it first. Every dep adds attack surface.

---

## 4. Project structure

```
/
├── CLAUDE.md                # This file
├── DESIGN.md                # Source of truth for what to build
├── EXECUTIVE-SUMMARY.md
├── OPEN-QUESTIONS.md
├── diagrams/
├── docs/
│   └── adr/                 # Architecture Decision Records
├── src/
│   ├── app/                 # Next.js App Router routes
│   │   ├── (dashboard)/     # operator-authenticated routes
│   │   ├── j/[token]/       # public driver link page
│   │   └── api/             # Route Handlers (webhooks, public link API)
│   ├── server/              # server-only modules (cannot be imported by client)
│   │   ├── domain/          # pure domain logic, no I/O
│   │   ├── db/              # Drizzle schema, queries, migrations
│   │   ├── services/        # use-case orchestration
│   │   ├── ports/           # interface definitions (NotificationPort, etc.)
│   │   ├── adapters/        # concrete impls (TwilioAdapter, SheetsAdapter)
│   │   └── auth/            # Lucia config
│   ├── components/          # React UI (presentational)
│   └── lib/                 # shared utilities (no business logic)
├── tests/
│   ├── unit/                # mirrors src/server/domain
│   ├── integration/         # spin up Postgres testcontainer
│   └── e2e/                 # Playwright
├── drizzle/                 # generated SQL migrations (committed)
├── .github/workflows/
└── docker-compose.yml       # local Postgres
```

**Architecture rule:** dependencies flow inward. `domain` knows nothing. `services` use `ports`. `adapters` implement `ports`. `app` calls `services`. Never the reverse.

---

## 5. Test-driven development (mandatory)

### The TDD loop, every time

1. **Red.** Write a failing test in `tests/` that describes the behavior you want.
2. **Run it.** Confirm it fails for the right reason.
3. **Green.** Write the minimum production code to pass.
4. **Refactor.** Tidy with tests still green.
5. **Coverage check.** Must remain ≥ 85% statements, ≥ 80% branches on `src/server/`.

### Test budget — non-negotiable

- **Unit + integration suite must complete in < 60 seconds locally and in CI.** This is enforced by a CI step. If it slips, fix it before merging anything else.
- **Unit tests** are pure, no I/O, < 5ms each.
- **Integration tests** use a single shared Postgres testcontainer (one boot per test run) with per-test transactions that roll back. Aim for < 200ms each.
- **E2E** is one Playwright smoke flow on the critical path (login → create booking → generate link → driver accepts → exec SMS captured → completion form → operator approves). Runs in CI separately, not counted against the 60s.

### What every feature gets

- Unit tests for domain logic (state transitions, validation, signing).
- Integration tests for every service that touches the DB or an adapter.
- A contract test for every adapter (Twilio, Sheets) using a fake.
- An e2e test for any new user-visible flow.
- A test that proves the **security** property (authn enforced, authz enforced, input rejected).

### Mocking policy

- **Mock only at port boundaries.** Never mock your own domain code.
- Adapters have a `Fake<Port>` implementation kept beside the real one. Tests use the fake; production uses the real.
- Date/time and IDs come from injected services (`Clock`, `IdGenerator`) so tests are deterministic.

---

## 6. Security — production-grade

### Authn / authz

- **Operators only.** No public write endpoints except the signed driver-link routes.
- Sessions in HTTP-only, Secure, SameSite=Lax cookies. 14-day expiry, sliding.
- Argon2id for password hashing. No password less than 12 chars.
- Brute-force protection: per-account rate limit on login, exponential backoff.

### Driver link signing

- Tokens are **HS256 JWTs signed with a per-environment 256-bit secret** loaded from env, never committed.
- Token payload: `{job_id, driver_id, link_type, exp, jti}`. `jti` is recorded in DB on first use so a token can be one-shot if needed.
- Tokens expire at `pickup_time + 48h` for dispatch links and `pickup_time + 7d` for completion links.
- Constant-time token verification.

### Input validation

- Zod schemas at **every** trust boundary: server actions, route handlers, public driver-link page, webhooks.
- Reject unknown fields (`.strict()`).
- Numeric ranges (waiting time, car park) validated; phone numbers parsed with `libphonenumber-js`.

### Output encoding

- React's default escaping for HTML. **Never** `dangerouslySetInnerHTML`.
- SMS template parameters are interpolated through a typed renderer that escapes nothing — design accordingly (no user-controlled text in SMS).

### Database

- Parameterised queries only (Drizzle does this). No `sql.raw` with user input.
- Row-level: every operator query filters by tenant (single tenant in MVP but coded that way).
- Audit log: append-only `audit_events` table, every state change writes a row with `actor, action, before, after, ts`.

### Secrets

- All secrets via env. `.env.example` committed, `.env*` (except `.example`) ignored.
- Twilio / Google / DB credentials never logged.
- Pre-commit hook runs `gitleaks` to block accidental secret commits.

### Headers & transport

- HTTPS enforced (HSTS, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`).
- CSP: `default-src 'self'`, no inline scripts, nonces for any unavoidable inline.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

### Rate limiting

- Per-IP and per-token rate limit on the public driver-link routes (sliding window, e.g. 30/min).
- Per-account login rate limit (5/min, then exponential backoff).

### Dependencies

- `pnpm audit` runs in CI; CVSS ≥ 7 fails the build.
- Renovate/Dependabot enabled.

### Logging

- Structured JSON via Pino. **Never** log: passwords, tokens, full phone numbers, full names of execs (log a hash).
- Every request gets a `request_id`; propagate to downstream calls.
- PII redaction enforced via a Pino redaction config — reviewed in PRs.

---

## 7. Git workflow

### Branching

- `main` is always deployable. Protected: no direct pushes, PR required, all checks green.
- Feature branches: `feat/<stage-NN>-<short-desc>`. Bugfix: `fix/<short-desc>`. Chore: `chore/<short-desc>`.
- One stage = one PR. Stages are defined in the build plan (`docs/build-plan.md`, created at kickoff).

### Commits

- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`, `ci:`).
- One logical change per commit. Tests in the same commit as the code they cover.
- No "WIP" commits on `main`. Squash on merge if a branch has fix-up commits.

### Pre-commit (enforced by Husky)

1. Biome format + lint (fail on warnings).
2. `tsc --noEmit` (typecheck).
3. `pnpm test` — **full unit + integration suite, must pass in < 60s**.
4. `gitleaks` secret scan.

A commit with failing pre-commit checks does not exist. Fix the issue and commit again — do not `--no-verify`.

### Pull requests

Every PR includes:

- **Summary** — 2–3 lines, plain English.
- **What changed** — bullet list referencing files.
- **Test plan** — checklist of what was verified.
- **Screenshots** for UI changes.
- **Migration notes** if DB schema changed (forward + rollback).
- **Security considerations** if any auth, input, or secret-handling path is touched.

CI must be green. At least one self-review pass before requesting external review. After merge, delete the branch.

### Stage workflow (this is what "after every stage raise a PR and merge" means)

For each stage in `docs/build-plan.md`:

1. Create branch `feat/<stage-NN>-<slug>`.
2. Write failing tests for the stage's acceptance criteria.
3. Implement until green.
4. Run full suite locally. Confirm < 60s.
5. Push and open PR.
6. CI runs the full pipeline.
7. Self-review the diff in GitHub UI.
8. Merge via squash. Delete branch.
9. Pull `main` locally. Start next stage.

---

## 8. CI pipeline (`.github/workflows/ci.yml`)

Runs on every push and PR:

1. **Setup** — Node 20, pnpm cache, Postgres service container.
2. **Install** — `pnpm install --frozen-lockfile`.
3. **Typecheck** — `pnpm typecheck`.
4. **Lint** — `pnpm lint`.
5. **Test** — `pnpm test --reporter=verbose` (must finish < 60s; CI fails if > 75s as a guardrail).
6. **Build** — `pnpm build`.
7. **E2E** — `pnpm test:e2e` (separate job, runs in parallel).
8. **Audit** — `pnpm audit --audit-level=high`.

---

## 9. Performance & scalability

- Target p95 dashboard interaction: **< 200ms** server time.
- Indexes on every column used in a `WHERE` or `ORDER BY`. Reviewed in migration PRs.
- Use `LIMIT` + cursor pagination for any list query. No unbounded `SELECT *`.
- N+1 queries are a bug; integration tests assert query counts on hot paths.
- The Clock loop is the only background process. It's idempotent and uses `SELECT … FOR UPDATE SKIP LOCKED` to be horizontally scalable later.
- All adapters time out (Twilio: 5s; Sheets: 10s; SMS retry queue handles failures).

---

## 10. Error handling

- Domain errors are typed (`Result<T, E>` or discriminated unions). No exceptions for control flow.
- Adapter errors are caught at the service layer, mapped to domain errors, logged with context.
- The UI receives a typed result; never shows a raw stack trace.
- All `console.log` is banned outside of `logger.ts`. Pino only.

---

## 11. Working with Claude Code

When Claude works on this repo:

- **Read `DESIGN.md` before writing code in a new area.** It is the source of truth.
- **Read this `CLAUDE.md` at the start of every session.**
- **Use TDD without prompting.** If a test isn't being written first, stop and write it.
- **Ask before adding a dependency.** Adding npm packages is a security event.
- **Ask before changing a public contract** (DB schema, API route shape, port interface).
- **Run the full suite before claiming completion.** Output the timing in the response so the human can verify it's < 60s.
- **Update `docs/adr/` for non-obvious decisions.** Future Claude reads them.
- **Do not work around failing tests by changing the test.** Find the real cause.
- **Do not bypass pre-commit hooks.** No `--no-verify`. Ever.

When the user asks "implement stage N", the loop is:

1. Open `docs/build-plan.md`, read the stage spec.
2. Open the relevant section of `DESIGN.md`.
3. Create the feature branch.
4. Write failing tests covering the acceptance criteria.
5. Implement.
6. Run full suite. Show timing.
7. Open PR with the template (§7).
8. Wait for human review unless told to merge.

---

## 12. Out of scope (do not build)

These are documented as out-of-scope in `DESIGN.md` §2. Do not build them without explicit user instruction:

- PA / secretary portal
- Native driver mobile app
- GPS tracking, live exec tracking link
- Auto-cascade dispatch
- Backfill subcontractor workflow in-app
- Per-executive records
- Automated billing / invoicing / payments
- Recurring bookings
- Multi-leg trips
- Multi-tenant

---

## 13. When stuck

- If a design decision is ambiguous, **ask the user**. Don't guess.
- If a test is hard to write, the code is probably wrong-shape. Refactor, don't lower the bar.
- If a stage feels too big for one PR, split it before starting work and update `docs/build-plan.md`.
