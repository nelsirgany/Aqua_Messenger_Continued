# Aqua Messenger API Contract

Three endpoints. Everything the ESP32 does is outbound, so the device works behind any router with no port forwarding, no static IP, and no MQTT broker.

Auth for the demo is a shared secret in `X-Aqua-Key`, from `process.env.AQUA_DEVICE_KEY`. Not production auth, and documented as such.

> **Battery has since been removed from the product.** `battery_adc_v` no longer appears in the heartbeat or event payloads below, and there is no server-side battery conversion or fault. The README has current curl examples.

---

## 1. `POST /api/heartbeat`

Every two hours on schedule, once on boot, and once a week with self-test results attached. Carries the reading at that moment. Not an aggregate.

```json
{
  "device_uid": "AQM-0001",
  "recorded_at": "2026-08-05T14:00:03Z",
  "trigger": "scheduled",
  "float_wet": false,
  "battery_adc_v": 1.94,
  "pitch_deg": 0.12,
  "roll_deg": -0.31,
  "imu_ok": true,
  "rssi_dbm": -67,
  "uptime_s": 486000,
  "firmware": "0.3.0"
}
```

**The device sends `battery_adc_v`, the voltage at the pin. The server multiplies by `divider_ratio` from the device's battery profile to get pack voltage.** The firmware does not know the divider ratio and must not. That is why swapping from 2S to 1S2P is a database update.

If `has_battery_sense` is false on the device row, `battery_adc_v` is omitted and the server stores `battery_v` as null. Never substitute a placeholder.

Server on receipt:
1. Store the heartbeat.
2. Update `devices.last_heartbeat_at`.
3. Run the fault evaluation in section 4.
4. If `float_wet` disagrees with the current open-event state, reconcile. A wet heartbeat with no open event means the opening POST was lost, so open an event backdated to the heartbeat. A dry heartbeat with an open event means the closing POST was lost, so close it. This makes lost packets self-healing, which matters on a device sitting in a metal hydrant.

Response `200`: `{ "ok": true, "faults_open": ["BATTERY_WARNING"] }`

## 2. `POST /api/events`

Fired the instant the float transitions. This is the alert path and the reason the product is not just a water audit tool.

```json
{
  "device_uid": "AQM-0001",
  "event": "opened",
  "occurred_at": "2026-08-05T15:12:41Z",
  "float_wet": true,
  "pitch_deg": 0.14,
  "roll_deg": -0.29,
  "battery_adc_v": 1.93
}
```

`event` is `opened` or `closed`.

- `opened`: insert an `open_events` row with `closed_at` null. If one is already open for this device, ignore the duplicate and return the existing row.
- `closed`: set `closed_at` on the open row. If none is open, insert a completed event using the last wet heartbeat as `opened_at` and flag it in `notes` as reconstructed.

Also insert a heartbeat row with `trigger = 'event'`, so the two-hour chart shows the transition at full resolution.

Debounce in firmware, not on the server: require the float to hold its new state for 10 seconds before transmitting. A hydrant being opened takes several turns of a wrench, so 10 seconds costs nothing and eliminates chatter from a float bouncing at the waterline.

Response `201`: `{ "event_id": "…", "state": "open", "hydrant": "H-27841" }`

## 3. `POST /api/selftest`

Sent weekly, or folded into a heartbeat with `trigger = 'weekly_selftest'` and this object in `selftest`. One request is simpler; use the folded form.

```json
{
  "imu_i2c_ack": true,
  "imu_self_test_passed": true,
  "float_gpio_reads": "dry",
  "battery_adc_raw": 2410,
  "wifi_connect_ms": 3120,
  "rtc_drift_s": 4,
  "free_heap": 184320,
  "reset_reason": "TIMER"
}
```

The self-test is what the department gets in place of an on-demand check button. It is scheduled rather than requested, which is the honest description: the console shows **last self-test** with a timestamp, not a **Run check** button. Do not build a button that does nothing.

If you later want on-demand checks, the pattern is a command queue: the console writes a pending row, the device picks it up on its next heartbeat, and the perceived latency equals the check-in interval. Note this in the roadmap; do not build it now.

## 4. Fault evaluation

Runs server-side on every heartbeat and event. Each check either opens a fault or resolves an open one of the same code. Faults are never deleted.

| Code | Opens when | Resolves when |
|---|---|---|
| `DEVICE_OFFLINE` | `now() - last_heartbeat_at > 3 * checkin_interval_s`, evaluated on read since no packet arrives to trigger it | any heartbeat arrives |
| `FLOAT_STUCK_WET` | wet continuously > 6 hours | float reads dry |
| `FLOAT_NEVER_WET` | no wet transition since install, and another device has reported one | first wet reading |
| `IMU_NO_RESPONSE` | `imu_ok` false, or self-test I2C ack false | `imu_ok` true |
| `HYDRANT_TILTED` | tilt delta from install baseline > 5° | delta back under 5° |
| `IMPACT_DETECTED` | acceleration spike reported, baseline unchanged | manual resolve |
| `BATTERY_WARNING` | pack V ≤ profile `v_warning` | pack V > `v_warning` + 0.1 hysteresis |
| `BATTERY_CRITICAL` | pack V ≤ profile `v_critical` | pack V > `v_critical` + 0.1 |
| `CLOCK_DRIFT` | `abs(recorded_at - received_at) > 60s` | drift back under 60s |

`DEVICE_OFFLINE` cannot be evaluated on write because it is defined by the absence of traffic. This is the single most important check in the system and the easiest one to forget, because nothing calls you to run it.

It is **evaluated on read**, not on a schedule. Vercel's Hobby plan allows two cron invocations per day, which is useless against a three-hour threshold. The console does not need the fault row to render the state — `v_hydrant_status` already derives `offline` from `last_heartbeat_at` against `checkin_interval_s` — so the row exists purely as the auditable maintenance record. It is therefore written lazily: the console's health reads call the same `evaluateOfflineDevices()` from `lib/faults.ts`, and the unique partial index on `(device_uid, code) where resolved_at is null` makes that idempotent under concurrent reads.

The row is stamped with when the device actually crossed the threshold (`last_heartbeat_at + 3 * interval`), not when the read happened to notice, so a late write is still an honest log. `GET /api/cron/evaluate` is retained as the same function behind a URL, for an external pinger if one is ever wanted.

Roadmap: move this to `pg_cron` inside Supabase, which is included and not subject to Vercel's limits. That removes Vercel from the loop entirely and is the right production answer. It is deliberately deferred because it would put fault logic in two languages.

Hysteresis on battery thresholds is not optional. Pack voltage sags under transmit load and recovers, so without it a device sitting near threshold will open and resolve a fault every two hours and fill the maintenance log with noise.

## 5. Read endpoints

- `GET /api/console/hydrants` returns `v_hydrant_status` for the map bounds.
- `GET /api/console/health` returns `v_device_health` ordered worst first.
- `GET /api/console/events?limit=50` returns `v_open_events`.
- `PATCH /api/console/events/:id` sets `use_classification`, `classified_by`, `classified_at`. This is the only write the console makes.

The console polls `GET /api/console/hydrants` every 10 seconds. Polling, not websockets: three lines, no half-open connection to fail on stage.

## 6. Validation

Reject with `422` and a plain message:

- Unknown `device_uid`.
- `recorded_at` more than 24 hours in the future.
- `battery_adc_v` outside 0 to 3.3.
- `pitch_deg` or `roll_deg` outside -180 to 180.
- `event` not in `opened` or `closed`.

Bad data reaching the console during a demo is worse than a rejected packet.

## 7. Demo path

The stage sequence is: the student lifts the float on the bench prototype, the ESP32 fires `POST /api/events` with `opened`, the console's barrel glyph fills blue within 10 seconds, and the hydrant pin turns from navy ring to filled blue on the map. Lowering the float closes the event and the console shows the duration and estimated gallons.

If WiFi fails on stage, the seeded live open event from `schema.md` section 6 is already on screen and the walkthrough is unaffected. Build so that failure is invisible.
