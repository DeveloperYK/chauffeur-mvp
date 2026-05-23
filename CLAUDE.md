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

### Pre-implementation test planning (mandatory)

Before writing ANY implementation code, you MUST:

1. **List all happy path scenarios** — every valid use case the function should handle.
2. **List all unhappy path scenarios** — validation failures, state errors, not found, unauthorized, edge cases.
3. **Define comprehensive seed data** — use `tests/fixtures/seed-data.ts` factories.
4. **Write failing tests FIRST** — with real assertions, not placeholders.

Example for a new service function:
```
Happy paths:
- creates booking with all valid fields
- creates booking with minimal required fields

Unhappy paths:
- invalid phone number format → validation error
- pickup time in past → validation error
- negative price → validation error
- duration out of range → validation error
- missing required fields → validation error

Side effects:
- audit event recorded
- mirrors to spreadsheet
```

### Test budget — non-negotiable

- **Unit + integration suite must complete in < 60 seconds locally and in CI.** This is enforced by a CI step. If it slips, fix it before merging anything else.
- **Unit tests** are pure, no I/O, < 5ms each.
- **Integration tests** use PGlite (in-memory Postgres) via `createTestDb()`. Aim for < 200ms each.
- **E2E** tests cover the critical paths (login → create booking → dispatch → completion). Runs in CI separately, not counted against the 60s.

### What every feature gets

- Unit tests for domain logic (state transitions, validation, signing).
- Integration tests for every service that touches the DB or an adapter.
- A contract test for every adapter (Twilio, Sheets) — same test suite runs against both fake and real.
- An e2e test for any new user-visible flow.
- A test that proves the **security** property (authn enforced, authz enforced, input rejected).
- **Minimum: 3 happy path + 3 unhappy path tests per function.**

### No-mock policy (strict)

**Tests must NEVER mock:**
- Domain functions
- Service functions  
- Database queries
- Internal business logic

**Tests use ONLY in-memory doubles at external boundaries:**
- `FakeNotificationAdapter` for SMS (implements `NotificationPort`)
- `FakeSpreadsheetMirror` for Google Sheets (implements `SpreadsheetMirrorPort`)
- `fixedClock()` or `TestClock` for time (implements `Clock`)
- `sequentialIdGenerator()` for deterministic IDs (implements `IdGenerator`)
- PGlite for database (real SQL, in-memory)

**Banned patterns:**
- `vi.mock()` — use in-memory doubles instead
- `vi.spyOn()` on production code — inject dependencies instead
- `vi.useFakeTimers()` — use `TestClock` instead
- Any Jest mocking utilities

**Allowed patterns:**
- `vi.fn()` for callback stubs where no production code exists
- `vi.spyOn()` on test doubles only (for "was called with" assertions)

### Contract tests

Every in-memory double MUST have a contract test in `tests/contracts/` that:
- Runs the same test suite against both the fake and real implementation
- Verifies behavioral equivalence
- Documents the port's behavioral contract

Structure:
```
tests/contracts/
├── notification.contract.ts        # Shared test cases
├── notification-fake.test.ts       # Run against FakeNotificationAdapter
├── notification-twilio.test.ts     # Run against TwilioNotificationAdapter
├── spreadsheet-mirror.contract.ts
├── spreadsheet-mirror-fake.test.ts
├── spreadsheet-mirror-google.test.ts
└── README.md
```

### Seed data factories

All tests use typed factory functions in `tests/fixtures/seed-data.ts`:
- `SeedData.operators.alice()` — returns valid operator data
- `SeedData.drivers.premiumTom()` — returns valid driver data
- `SeedData.bookings.unassigned(operatorId)` — returns booking in state
- Deterministic IDs via `sequentialIdGenerator`
- Deterministic time via `fixedClock`
- Realistic sample data matching production patterns

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
- **Restart the local dev server after every change.** After merging/applying any change that the user is testing locally, kill the running dev server on port 3000 and start it fresh (`kill $(lsof -ti:3000)`, then `pnpm dev` with the `.env` loaded). Do this without being asked — the user wants a clean restart each time so they never test against a stale process. Confirm it's healthy via `GET /api/healthz` before reporting done.

### Mandatory test execution before commit/push

**CRITICAL: Before EVERY commit and EVERY push, Claude MUST:**

1. **Run `pnpm test`** — Execute the full unit + integration test suite locally.
2. **Verify all tests pass** — Do not commit or push if any test fails.
3. **Check timing** — Suite must complete in < 60 seconds. If it exceeds this, investigate and fix before proceeding.
4. **Run `pnpm typecheck`** — Ensure no TypeScript errors.
5. **Run `pnpm lint`** — Ensure no linting errors.
6. **Run the simulator-driven lifecycle E2E** — `pnpm test:e2e:lifecycle` (see below). This is the only test that exercises the **whole booking lifecycle** through the real UI; the unit/integration suite alone does not.

**The sequence is:**
```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e:lifecycle
```

If any step fails, **STOP**. Fix the issue. Re-run from the beginning. Only after all four pass may you proceed with `git commit` and `git push`.

**Never assume tests will pass.** Always run them. Always verify the output. Report the results (pass count, timing) in your response so the human can confirm.

**This is non-negotiable.** Pushing broken code to the repository is not acceptable. The operators depend on this system.

### Mandatory end-to-end lifecycle test (`pnpm test:e2e:lifecycle`)

Unit + integration tests do not prove the app works end to end. Before every push you MUST also run the **full booking lifecycle** through the test simulator and the operator console:

- **Spec:** `tests/e2e/lifecycle.spec.ts`. It uses the **simulator** (`/dashboard/simulator`: seed, force-state, fast-forward, run clock tick) to drive ONE booking through every stage — `unassigned → assigned → in_progress → awaiting_driver_form → awaiting_operator_review → completed` — asserting the state after each transition, then **approves it from the console detail panel**, then **cancels a second booking** from the panel. Clock ticks fire the real transition logic and the in-memory SMS + Sheets-mirror side effects.
- **How to run:**
  1. Ensure a dev server is running on :3000 (`pnpm dev`) — the lifecycle spec runs against it (`E2E_BASE_URL=http://localhost:3000`), where auth is bypassed (first operator).
  2. `pnpm test:e2e:lifecycle`
- **Why it is separate from `pnpm test:e2e`:** the default Playwright run builds + serves in **production** mode (auth enforced) and `smoke.spec.ts` asserts the login redirect; the lifecycle spec needs the dev auth bypass and the simulator. Do not merge them.
- **Destructive:** the spec calls the simulator's **Reset all data**, wiping bookings + drivers in whatever DB the dev server points at. That is the simulator's purpose — never point the dev server at production data when running it.
- **Coverage rule:** when you add or change a booking **state transition**, a **state-aware console action**, or the **simulator**, extend `lifecycle.spec.ts` to cover it. A new stage in the flow that the lifecycle test does not exercise is an incomplete change.

When the user asks "implement stage N", the loop is:

1. Open `docs/build-plan.md`, read the stage spec.
2. Open the relevant section of `DESIGN.md`.
3. Create the feature branch.
4. Write failing tests covering the acceptance criteria.
5. Implement.
6. Run full suite. Show timing.
7. Open PR with the template (§7).
8. Wait for human review unless told to merge.

### Post-merge Vercel deployment check

When merging to main (or when told to merge):

1. After PR merge, use the Claude Code web Vercel connector to check deployment status.
2. Wait for deployment to complete (typically 1-2 minutes).
3. If deployment **fails**:
   - Read the deployment logs via Vercel connector.
   - Create a fix branch immediately (`fix/vercel-deploy-<issue>`).
   - Fix the issue before any other work.
   - Do not leave main in a broken state.
4. If deployment **succeeds**:
   - Confirm the deployment is healthy via `GET /api/healthz` on production URL.
5. Report deployment status in the completion message.

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
