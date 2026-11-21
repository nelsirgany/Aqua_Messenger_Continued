# Aqua Messenger: Build Brief

Read `design-language.md`, `schema.md`, and `api-contract.md` first. They are authoritative wherever they conflict with your defaults, **except for battery**, which has since been removed from the product entirely — see the note at the top of each of those three files and `db/migrations/0001_remove_battery.sql`.

## Stack

- Next.js 15, App Router, TypeScript.
- Tailwind with only the tokens from `design-language.md`. Delete the default palette so no stray `red-500` can appear; there is no alert colour in this product by design.
- `postgres` (porsager/postgres.js). No ORM.
- Map: MapLibre GL JS with a free raster or vector base. No Mapbox token, no Google Maps billing.
- Vercel. `DATABASE_URL` local in dev, Supabase in prod. One Vercel cron entry.
- No auth, no state library, no component library, no icon library.

## File layout

```
app/
  layout.tsx
  page.tsx                     keep the existing marketing site content
  console/page.tsx             server component, DEP default
  api/heartbeat/route.ts
  api/events/route.ts
  api/cron/evaluate/route.ts
  api/console/hydrants/route.ts
  api/console/health/route.ts
  api/console/events/[id]/route.ts
components/
  BarrelGlyph.tsx              the signature element
  HydrantMap.tsx               client
  HealthQueue.tsx
  EventLog.tsx
  RoleToggle.tsx               client
lib/
  db.ts
  faults.ts                    fault evaluation, single source
  types.ts
db/
  schema.sql
  seed.sql
  import_hydrants.ts
```

## Rules

**Fault logic exists once**, in `lib/faults.ts`, called by the heartbeat route, the events route, and the cron route. If a threshold comparison appears in a component or a route handler, that is a bug.

**Fault evaluation runs on write for everything except `DEVICE_OFFLINE`, which is evaluated on read, because the absence of data cannot trigger a webhook.** Every other fault arrives in a packet, and receiving that packet is the trigger. Offline is the one you can only detect by noticing that nothing came.

**Thresholds come from the database**, from `battery_profiles` and `fault_codes`. Never a constant in TypeScript.

**No aggregation in JavaScript.** Add a view instead.

**Severity is never colour.** Critical is an inverted black panel, warning is a navy left edge. There is no red in this codebase.

**Every gallon figure carries its assumption.** Render as `est. 47,000 gal @ 1,000 gpm nominal`. There is no flow sensor.

**Never classify an opening automatically.** Events arrive `unclassified` and a human tags them. The system cannot tell FDNY from a kid with a wrench.

## Order of work

1. `db/schema.sql`, then `import_hydrants.ts` against the real NYC Open Data endpoint, then `db/seed.sql`. Run the verification queries in `schema.md` section 7 and confirm the three device states before writing any UI.
2. `lib/db.ts` and the three view queries.
3. `BarrelGlyph`. Build it before any layout. Dry outline, blue fill when wet, rotates by tilt angle, inverts when critical.
4. `/console` DEP view: map, health queue, event log.
5. `POST /api/heartbeat` and `POST /api/events`, tested with curl before the ESP32 exists.
6. `lib/faults.ts` and the cron route. Verify `DEVICE_OFFLINE` opens on its own with no incoming packet.
7. FDNY view behind the toggle. It is mostly a filter and large type over work already done.
8. Polish the marketing page toward the console's palette last.

## Facts that must not drift

- NYC hydrants are **dry-barrel**. The barrel is dry unless the hydrant is open. Wet float means flowing. Say this in a comment at the top of `lib/faults.ts` so nobody later "fixes" the logic by adding a water level.
- The pack is **2S Li-ion, 8.4V full**, read through a 1MΩ / 330kΩ divider on an ADC1 pin at 11dB attenuation, measured across the raw pack ahead of the regulator. The server converts ADC volts to pack volts using `divider_ratio`.
- **A dead battery cannot report itself.** `DEVICE_OFFLINE` and `BATTERY_CRITICAL` are separate faults and silence is never treated as health.
- Hydrant identifiers are **DEP unit IDs** from NYC Open Data. Device IDs are ours. The console always shows both.
- There is **no on-demand check button**. The console shows a scheduled weekly self-test with a timestamp.

## Definition of done for the pitch

A student opens `/console`. The map shows a field of grey unmonitored hydrants with three live devices among them. One glyph is filled blue with an event running. One is drawn leaning with an inverted black panel reading `HYDRANT DISPLACED`. One is offline. They switch to the FDNY view and a single hydrant reads `OUT OF SERVICE` with a last-verified timestamp. Then they lift the float on the bench unit and a fourth glyph fills within ten seconds.

If the WiFi drops, everything above except the last sentence still works from seeded data.
