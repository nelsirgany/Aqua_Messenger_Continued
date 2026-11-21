# Aqua Messenger

Retrofit sensor console for NYC DEP: reports when a fire hydrant is opened, struck, or failing.
Full product spec lives in [`files/`](files) — `claude-code-brief.md`, `design-language.md`, `schema.md`, `api-contract.md`. Those documents are authoritative; this README is just the run-book.

**Battery has been removed from the product** (schema, faults, API payloads, UI). The spec docs in `files/` still describe the original battery design as written; they have not been rewritten to match. Where this README and those docs disagree on battery, the code — and this README — are current. See `db/migrations/0001_remove_battery.sql` for what changed and why.

## Stack

Next.js 15 (App Router, TypeScript), Tailwind (five-token palette, no default colors), `postgres` (porsager/postgres.js, no ORM), MapLibre GL JS (free CARTO raster tiles, no token), Vercel + one cron entry.

## Local setup

```bash
npm install
cp .env.local.example .env.local   # then fill in DATABASE_URL and AQUA_DEVICE_KEY
```

`DATABASE_URL` points at a local Postgres 15+ instance in dev, and the Supabase connection string in prod.

Build the database, in order:

```bash
npm run db:schema   # tables + views + reference data (db/schema.sql)
npm run db:import   # real hydrants from NYC Open Data 6pui-xhxz (db/import_hydrants.ts)
npm run db:seed     # devices, heartbeat history, deliberate faults (db/seed.sql)
```

Or all three: `npm run db:setup`.

Verify the three device states landed (schema.md section 7):

```bash
psql "$DATABASE_URL" -c "select dep_unit_id, service_state, currently_flowing, critical_faults from v_hydrant_status where deployment_state = 'monitored' order by dep_unit_id;"
```

Expect one device flowing, one out of service (tilted), one offline.

Then run the app:

```bash
npm run dev
```

- `/` — marketing site
- `/console` — DEP operations console (default view), FDNY toggle top right

## Testing the device endpoints before the ESP32 exists

```bash
curl -X POST http://localhost:3000/api/heartbeat \
  -H "Content-Type: application/json" -H "X-Aqua-Key: $AQUA_DEVICE_KEY" \
  -d '{"device_uid":"AQM-0001","recorded_at":"2026-08-05T14:00:03Z","trigger":"scheduled","float_wet":false,"pitch_deg":0.1,"roll_deg":-0.3,"imu_ok":true,"rssi_dbm":-67,"uptime_s":486000}'

curl -X POST http://localhost:3000/api/events \
  -H "Content-Type: application/json" -H "X-Aqua-Key: $AQUA_DEVICE_KEY" \
  -d '{"device_uid":"AQM-0001","event":"opened","occurred_at":"2026-08-05T15:12:41Z","float_wet":true,"pitch_deg":0.14,"roll_deg":-0.29}'
```

## Deploy

Vercel project with `DATABASE_URL` (Supabase) and `AQUA_DEVICE_KEY` set as env vars. No cron configuration is required.

## How `DEVICE_OFFLINE` is evaluated

Every fault except one is evaluated **on write**: it arrives in a packet, and receiving that packet is the trigger. `DEVICE_OFFLINE` is defined by the *absence* of a packet, so nothing calls you when it happens.

It is evaluated **on read**. Vercel's Hobby plan allows two cron invocations per day, which is useless against a three-hour offline threshold. The console does not need the persisted fault row to display the state — `v_hydrant_status` derives `offline` from `last_heartbeat_at` against `checkin_interval_s` at query time — so the row exists only as the auditable maintenance record, and it is written lazily by the console's health reads (`app/console/page.tsx` and `GET /api/console/health`), both calling `evaluateOfflineDevices()` from `lib/faults.ts`.

That is safe under concurrency: the unique partial index on `(device_uid, code) where resolved_at is null` makes opening a fault idempotent, so two simultaneous reads cannot double-insert.

The row records when the device actually went silent (`last_heartbeat_at + 3 × interval`), not when a read noticed, so the log stays accurate even though the write is late.

`GET /api/cron/evaluate` is retained — same function, behind a URL — so an external pinger (GitHub Actions schedule, cron-job.org) can drive it if wanted. It is safe at any frequency.

### Roadmap

Move offline evaluation to **`pg_cron` inside Supabase**, which is included and not subject to Vercel's limits. That is the right production answer and removes Vercel from the loop entirely. Deferred for now because it would put fault logic in two languages.

Also noted in `files/api-contract.md` §3: on-demand device checks would be a command queue — the console writes a pending row, the device picks it up on its next heartbeat. Not built; perceived latency would equal the check-in interval.
