# Aqua Messenger Data Model

Postgres 15+, identical on local and Supabase. Copy-paste runnable in order.

> **Battery has since been removed from the product** — `battery_profiles`, `devices.battery_profile`/`has_battery_sense`, `heartbeats.battery_v`, and the three battery fault codes are all gone from the running schema. Everything below describing battery is the original design and is kept for its rationale, but the SQL is no longer what's deployed. See `db/schema.sql` (current) and `db/migrations/0001_remove_battery.sql` (what changed) instead of copy-pasting from here.

---

## 1. Design decisions

**The float switch is one bit, and that bit is enough.** NYC hydrants are dry-barrel: the main valve sits below the frost line and the barrel drains itself after use, so the barrel is dry unless the hydrant is open. Wet means flowing. There is no threshold tuning and no signal processing. Do not model a water level; there isn't one.

**Two upload paths.** An event POST the moment the float changes state, and a scheduled heartbeat every two hours carrying the current reading. The event path is the product promise. The heartbeat is the audit trail and proof of life. A weekly heartbeat additionally carries self-test results.

**Store transitions, not samples.** The heartbeat is a point-in-time reading, not an aggregate, and it is stored as one row. Open events are derived from transitions and stored as their own rows with a start and an end. A chart of the last two hours is reconstructed from events plus heartbeats.

**Water loss is estimated, never measured.** No flow sensor exists on this device. `est_gallons` is duration times a nominal rate held per hydrant, and every surface that displays it says estimated.

**Battery config lives in the database.** The pack is 2S Li-ion, 8.4V full. Thresholds are rows, not constants, so a change to 1S2P is a one-row update rather than a firmware and UI change.

**Battery detection, since it came up:** a dead pack cannot report that it is dead. Voltage tells you the pack is *getting* low; missing heartbeats tell you it is *gone*. Both are needed, which is why `DEVICE_OFFLINE` is a separate critical fault from `BATTERY_CRITICAL`. The console must never treat silence as health.

---

## 2. Schema

```sql
drop view if exists v_hydrant_status;
drop view if exists v_device_health;
drop view if exists v_open_events;
drop table if exists faults;
drop table if exists open_events;
drop table if exists heartbeats;
drop table if exists devices;
drop table if exists hydrants;
drop table if exists battery_profiles;
drop table if exists fault_codes;

-- ---------------------------------------------------------
-- Battery pack profiles. Thresholds are data, not constants.
-- ---------------------------------------------------------
create table battery_profiles (
  code            text primary key,          -- '2S_LIION'
  display_name    text not null,
  cells_series    int  not null,
  cells_parallel  int  not null,
  divider_ratio   numeric(6,3) not null,     -- pack V = adc V * ratio
  v_full          numeric(5,2) not null,
  v_nominal       numeric(5,2) not null,
  v_warning       numeric(5,2) not null,
  v_critical      numeric(5,2) not null,
  v_cutoff        numeric(5,2) not null,
  gauge_is_linear boolean not null default true
);

-- ---------------------------------------------------------
-- Hydrants. Source of truth is NYC Open Data 6pui-xhxz.
-- dep_unit_id is DEP's identifier, not ours. Never invent one.
-- ---------------------------------------------------------
create table hydrants (
  id                uuid primary key default gen_random_uuid(),
  dep_unit_id       text unique not null,
  borough           text not null,
  street_address    text,
  latitude          numeric(9,6) not null,
  longitude         numeric(9,6) not null,
  nominal_flow_gpm  int not null default 1000,   -- for loss ESTIMATES only
  deployment_state  text not null default 'unmonitored'
                    check (deployment_state in ('unmonitored','monitored','pilot_proposed')),
  selection_note    text                          -- e.g. '311 open-hydrant complaints 2025'
);

create index on hydrants (deployment_state);

-- ---------------------------------------------------------
-- Devices. One per monitored hydrant.
-- ---------------------------------------------------------
create table devices (
  device_uid            text primary key,         -- 'AQM-0001'
  hydrant_id            uuid unique references hydrants(id) on delete set null,
  firmware              text not null default '0.3.0',
  battery_profile       text not null references battery_profiles(code),
  has_battery_sense     boolean not null default false, -- divider fitted?
  checkin_interval_s    int not null default 7200,
  install_pitch_deg     numeric(6,2),             -- IMU baseline at install
  install_roll_deg      numeric(6,2),
  installed_at          timestamptz,
  last_heartbeat_at     timestamptz,
  is_active             boolean not null default true
);

-- ---------------------------------------------------------
-- Heartbeats. A point-in-time reading. Not aggregated.
-- ---------------------------------------------------------
create table heartbeats (
  id             bigserial primary key,
  device_uid     text not null references devices(device_uid) on delete cascade,
  recorded_at    timestamptz not null,
  received_at    timestamptz not null default now(),
  trigger        text not null
                 check (trigger in ('scheduled','event','weekly_selftest','boot')),
  float_wet      boolean not null,
  battery_v      numeric(5,2),                   -- null if has_battery_sense = false
  pitch_deg      numeric(6,2),
  roll_deg       numeric(6,2),
  imu_ok         boolean not null default true,
  rssi_dbm       int,
  uptime_s       bigint,
  selftest       jsonb                            -- weekly only
);

create index on heartbeats (device_uid, recorded_at desc);

-- ---------------------------------------------------------
-- Open events. Derived from float transitions.
-- open_events.closed_at is null while the hydrant is flowing.
-- ---------------------------------------------------------
create table open_events (
  id                  uuid primary key default gen_random_uuid(),
  device_uid          text not null references devices(device_uid) on delete cascade,
  hydrant_id          uuid references hydrants(id) on delete set null,
  opened_at           timestamptz not null,
  closed_at           timestamptz,
  duration_seconds    int generated always as (
                        case when closed_at is null then null
                        else extract(epoch from (closed_at - opened_at))::int end
                      ) stored,
  use_classification  text not null default 'unclassified'
                      check (use_classification in ('unclassified','authorized','illegal','test')),
  classified_by       text,
  classified_at       timestamptz,
  notes               text
);

create index on open_events (device_uid, opened_at desc);
create unique index one_open_event_per_device
  on open_events (device_uid) where closed_at is null;

-- ---------------------------------------------------------
-- Faults. Persistent, with resolution. This is the
-- auditable maintenance log the buyer is actually paying for.
-- ---------------------------------------------------------
create table fault_codes (
  code        text primary key,
  severity    text not null check (severity in ('info','warning','critical')),
  title       text not null,
  detection   text not null,
  is_active   boolean not null default true   -- false = detection not wired yet
);

create table faults (
  id           uuid primary key default gen_random_uuid(),
  device_uid   text not null references devices(device_uid) on delete cascade,
  code         text not null references fault_codes(code),
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  detail       jsonb
);

create index on faults (device_uid) where resolved_at is null;
create unique index one_open_fault_per_code
  on faults (device_uid, code) where resolved_at is null;
```

## 3. Views

```sql
-- FDNY view: one question per hydrant.
create view v_hydrant_status as
select
  h.id                as hydrant_id,
  h.dep_unit_id,
  h.borough,
  h.street_address,
  h.latitude,
  h.longitude,
  h.deployment_state,
  d.device_uid,
  d.last_heartbeat_at,
  coalesce(oe.opened_at is not null, false)          as currently_flowing,
  oe.opened_at                                       as flowing_since,
  (select count(*) from faults f
    where f.device_uid = d.device_uid
      and f.resolved_at is null
      and f.code in (select code from fault_codes where severity = 'critical')
  )                                                  as critical_faults,
  case
    when h.deployment_state <> 'monitored'           then 'unmonitored'
    when d.last_heartbeat_at is null                 then 'never_reported'
    when d.last_heartbeat_at < now()
         - (d.checkin_interval_s * 3 || ' seconds')::interval then 'offline'
    when exists (select 1 from faults f
                 join fault_codes fc on fc.code = f.code
                 where f.device_uid = d.device_uid
                   and f.resolved_at is null
                   and fc.severity = 'critical')     then 'out_of_service'
    when oe.opened_at is not null                    then 'flowing'
    else 'in_service'
  end                                                as service_state
from hydrants h
left join devices d on d.hydrant_id = h.id
left join open_events oe on oe.device_uid = d.device_uid and oe.closed_at is null;

-- DEP view: device health queue.
create view v_device_health as
select
  d.device_uid,
  h.dep_unit_id,
  h.street_address,
  d.firmware,
  d.last_heartbeat_at,
  hb.battery_v,
  bp.v_warning,
  bp.v_critical,
  bp.gauge_is_linear,
  case
    when not d.has_battery_sense    then 'not_fitted'
    when hb.battery_v is null       then 'unknown'
    when hb.battery_v <= bp.v_critical then 'critical'
    when hb.battery_v <= bp.v_warning  then 'warning'
    else 'ok'
  end                                     as battery_state,
  hb.float_wet,
  hb.pitch_deg,
  hb.roll_deg,
  round(sqrt(power(coalesce(hb.pitch_deg,0) - coalesce(d.install_pitch_deg,0), 2)
           + power(coalesce(hb.roll_deg,0)  - coalesce(d.install_roll_deg,0),  2))::numeric, 2)
                                          as tilt_delta_deg,
  (select count(*) from faults f where f.device_uid = d.device_uid and f.resolved_at is null)
                                          as open_faults,
  (select max(fc.severity) from faults f join fault_codes fc on fc.code = f.code
    where f.device_uid = d.device_uid and f.resolved_at is null)
                                          as worst_severity
from devices d
left join hydrants h on h.id = d.hydrant_id
join battery_profiles bp on bp.code = d.battery_profile
left join lateral (
  select * from heartbeats hb2
   where hb2.device_uid = d.device_uid
   order by recorded_at desc limit 1
) hb on true;

-- DEP view: open events with ESTIMATED loss.
create view v_open_events as
select
  oe.id,
  oe.device_uid,
  h.dep_unit_id,
  h.street_address,
  h.borough,
  oe.opened_at,
  oe.closed_at,
  oe.duration_seconds,
  round(oe.duration_seconds / 60.0, 1)                        as duration_minutes,
  h.nominal_flow_gpm,
  round(oe.duration_seconds / 60.0 * h.nominal_flow_gpm)      as est_gallons,
  oe.use_classification,
  oe.classified_by,
  oe.classified_at
from open_events oe
left join hydrants h on h.id = oe.hydrant_id;
```

`est_gallons` is an estimate at nominal flow. Every UI surface that renders it must render the nominal rate beside it.

## 4. Reference data

```sql
insert into battery_profiles
(code, display_name, cells_series, cells_parallel, divider_ratio,
 v_full, v_nominal, v_warning, v_critical, v_cutoff, gauge_is_linear) values
('2S_LIION', '2S Li-ion (2 x 3.7V, series)', 2, 1, 4.030, 8.40, 7.40, 7.00, 6.60, 6.00, true),
('1S2P_LIION','1S2P Li-ion (2 x 3.7V, parallel)',1, 2, 2.000, 4.20, 3.70, 3.50, 3.30, 3.00, true);

-- Current build is 2S. Divider: 1M top / 330k bottom, ADC1 pin, 11dB attenuation,
-- 100nF to ground, measured across the raw pack ahead of the regulator.

insert into fault_codes (code, severity, title, detection, is_active) values
('DEVICE_OFFLINE',    'critical','Device offline',
 'No heartbeat received for 3 check-in intervals.', true),
('FLOAT_STUCK_WET',   'critical','Float stuck wet',
 'Float reads wet continuously for more than 6 hours. Masks all future openings.', true),
('FLOAT_NEVER_WET',   'warning','Float never triggered',
 'No wet transition since install while neighbouring devices have reported openings.', true),
('IMU_NO_RESPONSE',   'critical','IMU not responding',
 'No I2C acknowledgement at address 0x68 during self-test.', true),
('HYDRANT_TILTED',    'critical','Hydrant displaced',
 'Orientation more than 5 degrees from install baseline. Probable vehicle strike.', true),
('IMPACT_DETECTED',   'warning','Impact detected',
 'Acceleration spike above threshold with orientation returning to baseline.', true),
('BATTERY_WARNING',   'warning','Battery low',
 'Pack voltage at or below the profile warning threshold.', true),
('BATTERY_CRITICAL',  'critical','Battery critical',
 'Pack voltage at or below the profile critical threshold.', true),
('CLOCK_DRIFT',       'info','Clock drift',
 'Device timestamp differs from server by more than 60 seconds.', true),
('BATTERY_NOT_FITTED','info','Battery sensing not fitted',
 'Voltage divider absent on this unit. Battery state unknown by design.', true);
```

`is_active` exists so a check that is designed but not yet wired can be listed honestly rather than faked. If the divider is not soldered on demo day, set `has_battery_sense = false` on that device and the console shows `not_fitted` instead of inventing a voltage. Do not seed fake voltages for a device that cannot measure them.

## 5. Hydrant import

Do not hand-write hydrant rows. Pull real ones from NYC Open Data, dataset `6pui-xhxz`, bounded to one neighbourhood so the map stays fast.

```bash
# ~400 hydrants around NYU Tandon, downtown Brooklyn.
curl -s 'https://data.cityofnewyork.us/resource/6pui-xhxz.json?$limit=400&$where=within_circle(the_geom,%2040.6942,%20-73.9865,%201200)' \
  -o db/hydrants_raw.json
```

Inspect the returned column names before writing the loader; Socrata field names differ between dataset revisions, so map them at import time rather than assuming. Load into a staging table, then:

```sql
insert into hydrants (dep_unit_id, borough, street_address, latitude, longitude)
select unitid, borough, address, lat, lon from hydrants_staging
on conflict (dep_unit_id) do nothing;
```

Every imported hydrant defaults to `unmonitored`. That grey field on the map is the sales argument, so it should be real.

## 6. Seed: devices and history

Three monitored devices at real DEP hydrants, three `pilot_proposed`, deliberate faults on two units.

```sql
select setseed(0.31);

-- Promote three real imported hydrants to monitored. Adjust the unit IDs
-- to ones that actually exist in your import.
update hydrants set deployment_state = 'monitored'
where dep_unit_id in (select dep_unit_id from hydrants order by dep_unit_id limit 3);

-- Three more as proposed pilot sites, justified by 311 complaint history.
update hydrants
   set deployment_state = 'pilot_proposed',
       selection_note   = 'Selected from NYC 311 open-hydrant complaint records'
where dep_unit_id in (
  select dep_unit_id from hydrants
   where deployment_state = 'unmonitored' order by dep_unit_id limit 3
);

insert into devices
(device_uid, hydrant_id, battery_profile, has_battery_sense,
 install_pitch_deg, install_roll_deg, installed_at, last_heartbeat_at)
select
  'AQM-' || lpad((row_number() over (order by dep_unit_id))::text, 4, '0'),
  id, '2S_LIION', true, 0.0, 0.0,
  timestamptz '2026-06-15 09:00',
  now() - interval '20 minutes'
from hydrants where deployment_state = 'monitored';

-- Two hours of heartbeats, plus history, for every device.
insert into heartbeats (device_uid, recorded_at, trigger, float_wet, battery_v,
                        pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s)
select
  d.device_uid,
  now() - (g * interval '2 hours'),
  case when g % 84 = 0 then 'weekly_selftest' else 'scheduled' end,
  false,
  round((8.40 - (g * 0.004) - random() * 0.05)::numeric, 2),
  round((random() * 0.6 - 0.3)::numeric, 2),
  round((random() * 0.6 - 0.3)::numeric, 2),
  true,
  -60 - floor(random() * 25)::int,
  g * 7200
from devices d cross join generate_series(0, 250) g;

-- A closed illegal opening: 47 minutes on a hot afternoon.
insert into open_events (device_uid, hydrant_id, opened_at, closed_at, use_classification, classified_by, classified_at)
select d.device_uid, d.hydrant_id,
       timestamptz '2026-08-02 15:12', timestamptz '2026-08-02 15:59',
       'illegal', 'dep.dispatch', timestamptz '2026-08-02 16:40'
from devices d order by d.device_uid limit 1;

-- A closed authorized use.
insert into open_events (device_uid, hydrant_id, opened_at, closed_at, use_classification, classified_by, classified_at)
select d.device_uid, d.hydrant_id,
       timestamptz '2026-07-29 04:02', timestamptz '2026-07-29 04:31',
       'authorized', 'dep.dispatch', timestamptz '2026-07-29 09:15'
from devices d order by d.device_uid offset 1 limit 1;

-- An event still open right now. This is what the console shows live.
insert into open_events (device_uid, hydrant_id, opened_at)
select d.device_uid, d.hydrant_id, now() - interval '18 minutes'
from devices d order by d.device_uid limit 1;

update heartbeats set float_wet = true
where device_uid = (select device_uid from devices order by device_uid limit 1)
  and recorded_at > now() - interval '20 minutes';

-- Device two: displaced by a vehicle strike, and low battery.
update devices set last_heartbeat_at = now() - interval '35 minutes'
where device_uid = (select device_uid from devices order by device_uid offset 1 limit 1);

insert into heartbeats (device_uid, recorded_at, trigger, float_wet, battery_v,
                        pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s)
select device_uid, now() - interval '35 minutes', 'scheduled', false,
       6.82, 11.40, 4.20, true, -78, 340000
from devices order by device_uid offset 1 limit 1;

insert into faults (device_uid, code, opened_at, detail)
select device_uid, 'HYDRANT_TILTED', now() - interval '35 minutes',
       jsonb_build_object('tilt_delta_deg', 12.14, 'baseline_pitch', 0.0)
from devices order by device_uid offset 1 limit 1;

insert into faults (device_uid, code, opened_at, detail)
select device_uid, 'BATTERY_WARNING', now() - interval '35 minutes',
       jsonb_build_object('battery_v', 6.82, 'v_warning', 7.00)
from devices order by device_uid offset 1 limit 1;

-- Device three: silent. The fault that matters most, because a dead
-- device cannot report that it is dead.
update devices set last_heartbeat_at = now() - interval '9 hours'
where device_uid = (select device_uid from devices order by device_uid offset 2 limit 1);

insert into faults (device_uid, code, opened_at, detail)
select device_uid, 'DEVICE_OFFLINE', now() - interval '3 hours',
       jsonb_build_object('last_heartbeat_at', now() - interval '9 hours',
                          'expected_interval_s', 7200)
from devices order by device_uid offset 2 limit 1;
```

## 7. Verification

```sql
select dep_unit_id, service_state, currently_flowing, critical_faults
from v_hydrant_status where deployment_state = 'monitored' order by dep_unit_id;

select device_uid, battery_state, battery_v, tilt_delta_deg, open_faults, worst_severity
from v_device_health order by worst_severity desc nulls last;

select dep_unit_id, duration_minutes, est_gallons, use_classification
from v_open_events order by opened_at desc;
```

Expected: device one flowing right now with a live open event, device two out of service on tilt with a battery warning, device three offline. The 47-minute event estimates 47,000 gallons. If those three states are not visible, the console has nothing to demonstrate and the seed needs rerunning.
