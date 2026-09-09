# Production monitoring & alerting

What watches production, what it alerts on, and how to set each piece up.
Background: ADR 0014 (fail fast), ADR 0015 (deep readiness probe).

## Endpoints

| Endpoint | What it proves | Use |
|---|---|---|
| `GET /api/healthz` | Postgres answers `select 1` | cheap liveness only — **stayed green through the 8–9 Sep outage** |
| `GET /api/readyz` | the board's real queries complete within 5 s through the live pool | **the endpoint monitors must hit** — 200 `{ok:true, ms}` or 503 `{ok:false, reason, message, ms}` |
| `GET /api/clock-tick` | Vercel Cron, every minute | on success it GETs `CLOCK_TICK_HEARTBEAT_URL` if set |

## 1. Better Stack (uptime + heartbeat) — one-time setup, ~10 minutes

Free tier: 10 monitors, 3-minute checks, heartbeats, email/Discord alerts.

1. Sign up at https://betterstack.com/uptime (use the company login, not a personal one).
2. **Uptime monitor** → Create monitor:
   - URL: `https://chauffeur-prod.vercel.app/api/readyz`
   - Check frequency: 1 min if offered, else 3 min. Expected status: 2xx.
   - Regions: Europe. Confirmation period: 1 min (so one blip does not page).
   - Name it `chauffeur-prod readyz`.
3. **Heartbeat** → Create heartbeat:
   - Name `chauffeur-prod clock-tick`, period **1 minute**, grace **3 minutes**.
   - Copy the heartbeat URL it gives you (`https://uptime.betterstack.com/api/v1/heartbeat/<token>`).
4. Put the heartbeat URL in Vercel: project **chauffeur-prod** → Settings → Environment Variables → `CLOCK_TICK_HEARTBEAT_URL` = that URL, Production only → **Redeploy**. Within a few minutes the heartbeat should show "Up".
5. (Optional) A second uptime monitor on staging: `https://chauffeur-staging.vercel.app/api/readyz`, alerts to you only.

## 2. Where alerts go

Better Stack → Integrations:
- **Email**: add each operator's address + yours. This is the minimum.
- **Discord**: create a channel `#chauffeur-alerts`, channel settings → Integrations → Webhooks → New webhook → copy URL; in Better Stack add the Discord integration with that URL. Attach it to both monitors' escalation policy.
- **Phone/SMS** are on paid tiers; email + Discord push notifications are enough for a 4-person team as long as everyone has the Discord app with notifications on for that channel.

## 3. Hourly Claude watchdog (cloud routine)

An hourly cloud routine (https://claude.ai/code/routines) with the Vercel and Gmail connectors:
- GETs `/api/readyz` and `/api/healthz` on production.
- Reads Vercel runtime error groups for `chauffeur-prod` over the last hour.
- If readyz is not 200, or a new error group appeared with ≥ 3 occurrences on `/dashboard` or a server action, it investigates (routes, error text, recent deploys) and **emails the owner** a short diagnosis with the likely cause and the first thing to try. Otherwise it sends nothing.
- It never changes production. Fixing is a human + interactive-session decision.

Cadence is limited to once an hour by the platform; Better Stack covers the minutes in between.

## 4. When an alert fires — first 5 minutes

1. Open `https://chauffeur-prod.vercel.app/api/readyz` in a browser. Read `reason`/`message`.
2. `reason: "timeout"` → the pool/pooler is stalling. Check Supabase status (https://status.supabase.com) and Vercel runtime errors for `CONNECTION_DESTROYED` / `statement timeout`. Redeploying the current production deployment (Vercel → Deployments → ⋯ → Redeploy) replaces every function instance and usually clears a wedged pool.
3. `reason: "error"` → read `message`. `column … does not exist` means a migration did not run: check the deploy's build log.
4. Heartbeat "Down" but readyz 200 → the cron is not firing. Vercel → project → Cron Jobs: confirm it is listed and its last runs are 200. `CRON_SECRET` must be set in Production.
5. Post what you found in `#chauffeur-alerts` so the next person does not redo it.
