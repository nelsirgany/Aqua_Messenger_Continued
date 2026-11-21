-- Aqua Messenger schema. Postgres 15+, identical local and Supabase.
-- See files/schema.md for the design rationale.
--
-- Battery removed by request: no battery_profiles table, no
-- devices.battery_profile / has_battery_sense, no heartbeats.battery_v,
-- no BATTERY_WARNING / BATTERY_CRITICAL / BATTERY_NOT_FITTED fault codes.
-- To apply this to a database created before this change, run
-- db/migrations/0001_remove_battery.sql instead of re-running this file
-- (this file drops and recreates every table).

drop view if exists v_hydrant_status;
drop view if exists v_device_health;
drop view if exists v_open_events;
drop table if exists faults;
drop table if exists open_events;
drop table if exists heartbeats;
drop table if exists devices;
drop table if exists hydrants;
drop table if exists fault_codes;

create extension if not exists pgcrypto;

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

-- Supports the viewport bbox scan behind /api/console/field. Without
-- this, every map pan is a sequential scan over ~110k rows.
create index hydrants_unmonitored_lat_lng_idx
  on hydrants (deployment_state, latitude, longitude)
  where deployment_state = 'unmonitored';

-- ---------------------------------------------------------
-- Devices. One per monitored hydrant.
-- ---------------------------------------------------------
create table devices (
  device_uid            text primary key,         -- 'AQM-0001'
  hydrant_id            uuid unique references hydrants(id) on delete set null,
  firmware              text not null default '0.3.0',
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

-- ===========================================================
-- Views
-- ===========================================================

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
  -- Classification of the opening that is running right now, if any.
  -- Stays 'unclassified' until a person tags it; the console colours a
  -- use as illegal only once that has happened.
  oe.use_classification                              as current_use_classification,
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
  hb.float_wet,
  hb.pitch_deg,
  hb.roll_deg,
  round(sqrt(power(coalesce(hb.pitch_deg,0) - coalesce(d.install_pitch_deg,0), 2)
           + power(coalesce(hb.roll_deg,0)  - coalesce(d.install_roll_deg,0),  2))::numeric, 2)
                                          as tilt_delta_deg,
  (select count(*) from faults f where f.device_uid = d.device_uid and f.resolved_at is null)
                                          as open_faults,
  (select fc.severity from faults f join fault_codes fc on fc.code = f.code
    where f.device_uid = d.device_uid and f.resolved_at is null
    order by case fc.severity
      when 'critical' then 0 when 'warning' then 1 when 'info' then 2 end
    limit 1)                             as worst_severity,
  -- The actual fault names, not just a count — e.g. '["Hydrant displaced",
  -- "Device offline"]', worst severity first. This is what the health
  -- queue renders instead of a bare "N open faults".
  (select coalesce(json_agg(fc.title order by
            case fc.severity when 'critical' then 0 when 'warning' then 1 when 'info' then 2 end,
            f.opened_at
          ), '[]'::json)
    from faults f join fault_codes fc on fc.code = f.code
    where f.device_uid = d.device_uid and f.resolved_at is null
  )                                     as open_fault_titles
from devices d
left join hydrants h on h.id = d.hydrant_id
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

-- ===========================================================
-- Reference data
-- ===========================================================

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
('CLOCK_DRIFT',       'info','Clock drift',
 'Device timestamp differs from server by more than 60 seconds.', true);
