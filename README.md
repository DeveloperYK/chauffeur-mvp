# Chauffeur Dispatch — MVP

Production-grade dispatch platform for a chauffeur company. See [`DESIGN.md`](./DESIGN.md) for the full design and [`CLAUDE.md`](./CLAUDE.md) for the engineering rules of engagement.

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure env
cp .env.example .env
# generate a secret for the driver-link JWT:
openssl rand -base64 32   # paste into DRIVER_LINK_SECRET

# 3. Start Postgres locally (docker-compose) OR point DATABASE_URL elsewhere
docker compose up -d postgres

# 4. Run migrations
pnpm db:migrate

# 5. Create an operator account
DATABASE_URL=postgres://chauffeur:chauffeur_dev@localhost:5432/chauffeur \
  pnpm tsx scripts/create-operator.ts alice@example.com "Alice" "long-password-here-12+chars"

# 6. Run the app
pnpm dev
```

The dashboard lives at <http://localhost:3000/dashboard>.

## Architecture

```
                       ┌──────────────────┐
                       │ Operator browser │
                       └────────┬─────────┘
                                │ HTTPS
                                ▼
                       ┌──────────────────┐
                       │  Next.js app     │
                       │  (App Router)    │
                       └──────┬───────────┘
   ┌─────────┐                │
   │ SMS via │◀───────────────┤
   │ Twilio  │                │
   └─────────┘                │
                              ▼
                      ┌──────────────┐
   ┌─────────┐        │  Postgres    │
   │ Google  │◀──────▶│  (Drizzle)   │
   │ Sheets  │        └──────────────┘
   │ mirror  │                ▲
   └─────────┘                │  Cron POST /api/clock-tick (every 60s)
```

See [`docs/build-plan.md`](./docs/build-plan.md) for the stage-by-stage build log and [`docs/adr/`](./docs/adr/) for architecture decision records.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server (HMR) |
| `pnpm build` | Production build |
| `pnpm start` | Run production build |
| `pnpm test` | Unit + integration suite (must stay < 60s) |
| `pnpm test:e2e` | Playwright smoke tests |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | Biome (lint + format) |
| `pnpm lint:fix` | Biome auto-fix |
| `pnpm db:generate` | Regenerate Drizzle SQL migrations from schema |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio (DB inspector) |

## Production deploy checklist

- [ ] Set `DRIVER_LINK_SECRET` to a random 32+ byte value.
- [ ] Set `DATABASE_URL` to a managed Postgres with SSL.
- [ ] Set `TWILIO_*` env vars (otherwise SMS no-ops via fake).
- [ ] Set `GOOGLE_SHEETS_SPREADSHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON`. Share the sheet with the service account email. Run `await mirror.ensureHeaders()` once.
- [ ] Set `CLOCK_TICK_SECRET` and wire an external cron to POST `/api/clock-tick` with header `x-clock-secret: <value>` every 60 seconds.
- [ ] Run `pnpm db:migrate` after each deploy.
- [ ] Create operator accounts via `scripts/create-operator.ts`.

## Repository tour

- `src/app/(dashboard)/` — operator-authenticated routes
- `src/app/j/[token]/` — public driver-link page (no login)
- `src/app/api/` — public endpoints (clock-tick, healthz)
- `src/server/domain/` — pure domain logic (no I/O)
- `src/server/services/` — use-case orchestration
- `src/server/ports/` — interface definitions
- `src/server/adapters/` — concrete implementations (Twilio, Google Sheets, plus fakes)
- `src/server/db/` — Drizzle schema + client
- `tests/unit/` — pure unit tests
- `tests/integration/` — PGlite-backed integration tests
- `tests/e2e/` — Playwright smoke tests
