# Build plan

Each stage = one PR. Tests written first (TDD). Full unit+integration suite must finish in < 60s. CI must be green before merge.

| # | Stage | Branch | PR scope |
|---|---|---|---|
| 0 | Scaffolding | `feat/stage-00-scaffolding` | Repo skeleton, deps, configs, CI, docker-compose, Husky, ADRs |
| 1 | DB schema + migrations | `feat/stage-01-db-schema` | Drizzle schema for operators/drivers/bookings/audit_events/sessions; migration runner; integration test harness |
| 2 | Operator auth (Lucia) | `feat/stage-02-auth` | Login form, session cookie, argon2id password hashing, rate-limit, dashboard middleware |
| 3 | Domain core | `feat/stage-03-domain` | Pure state-machine transitions and JWT link signing; 100% unit-tested |
| 4 | Booking creation + board | `feat/stage-04-booking` | New-booking server action, validation, 7-column board UI, audit on create |
| 5 | Driver roster CRUD | `feat/stage-05-roster` | Roster page; create/edit/deactivate drivers; tier + default car + WhatsApp number |
| 6 | Dispatch flow | `feat/stage-06-dispatch` | Generate signed link from a ticket; public /j/[token] page; accept/decline; car change; Unassigned→Assigned transition |
| 7 | Clock service | `feat/stage-07-clock` | Scheduler: T-1h, T+expected_end, 24h no-accept; SELECT … FOR UPDATE SKIP LOCKED |
| 8 | SMS adapter | `feat/stage-08-sms` | NotificationPort, TwilioAdapter, FakeNotificationAdapter; fire on Assigned + InProgress |
| 9 | Completion form + review | `feat/stage-09-completion` | Driver second link, completion form, AwaitingReview→Completed flow |
| 10 | Google Sheets mirror | `feat/stage-10-sheets` | SpreadsheetMirrorPort + GoogleSheetsAdapter + Fake; write-through; resync script |
| 11 | E2E smoke + polish | `feat/stage-11-polish` | Playwright happy path, error boundaries, a11y pass |

## Stage acceptance criteria

Every stage must:

1. Add tests **before** code.
2. Implement to the design in `DESIGN.md` — no scope creep.
3. Keep total `pnpm test` runtime < 60s.
4. Pass CI: typecheck, lint, test, build, audit.
5. Document non-obvious choices in `docs/adr/`.
6. Include security considerations in the PR description if applicable.
7. Be a vertical slice — no dead code, no half-built features.
