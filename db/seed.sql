-- Seed devices and history against real imported hydrants.
-- Run schema.sql, then import_hydrants.ts, then this file.
-- Three monitored devices at real DEP hydrants, three pilot_proposed,
-- deliberate faults on two units. See files/schema.md section 6/7.

-- Re-runnable by design. Every timestamp below is relative to now(), so a
-- seed left sitting overnight shows all three devices as offline and the
-- demo scenario is gone. Refresh it on demo day with `npm run db:seed`;
-- clearing the previous demo state here is what makes that safe to repeat
-- without re-importing 110k hydrants.
delete from faults;
delete from open_events;
delete from heartbeats;
delete from devices;
update hydrants
   set deployment_state = 'unmonitored',
       selection_note   = null
 where deployment_state <> 'unmonitored';

select setseed(0.31);

-- The import is citywide (~110k hydrants), so anchor the pilot cluster
-- geographically instead of by unit id: the three monitored devices and
-- the three proposed sites must sit together in downtown Brooklyn, where
-- the console centres its map. Plain euclidean distance on lat/lon is
-- accurate enough at neighbourhood scale and avoids requiring PostGIS.
create temporary view v_demo_sites as
  select dep_unit_id,
         (latitude - 40.6942) * (latitude - 40.6942)
       + (longitude + 73.9865) * (longitude + 73.9865) as dist2
  from hydrants;

-- Promote the three closest real hydrants to monitored.
update hydrants set deployment_state = 'monitored'
where dep_unit_id in (
  select dep_unit_id from v_demo_sites order by dist2 limit 3
);

-- Three more as proposed pilot sites, justified by 311 complaint history.
update hydrants
   set deployment_state = 'pilot_proposed',
       selection_note   = 'Selected from NYC 311 open-hydrant complaint records'
where dep_unit_id in (
  select d.dep_unit_id from v_demo_sites d
    join hydrants h on h.dep_unit_id = d.dep_unit_id
   where h.deployment_state = 'unmonitored'
   order by d.dist2 limit 3
);

insert into devices
(device_uid, hydrant_id, install_pitch_deg, install_roll_deg, installed_at, last_heartbeat_at)
select
  'AQM-' || lpad((row_number() over (order by dep_unit_id))::text, 4, '0'),
  id, 0.0, 0.0,
  now() - interval '45 days',
  now() - interval '20 minutes'
from hydrants where deployment_state = 'monitored';

-- History going back from two hours ago. g starts at 1, not 0, so the
-- generic loop never plants a "now" reading that would outrank the
-- deliberate current-state heartbeats inserted below for each device.
insert into heartbeats (device_uid, recorded_at, trigger, float_wet,
                        pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s)
select
  d.device_uid,
  now() - (g * interval '2 hours'),
  case when g % 84 = 0 then 'weekly_selftest' else 'scheduled' end,
  false,
  round((random() * 0.6 - 0.3)::numeric, 2),
  round((random() * 0.6 - 0.3)::numeric, 2),
  true,
  -60 - floor(random() * 25)::int,
  g * 7200
from devices d cross join generate_series(1, 250) g;

-- Device one's current reading: wet, matching the live open event below.
insert into heartbeats (device_uid, recorded_at, trigger, float_wet,
                        pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s)
select device_uid, now() - interval '18 minutes', 'event', true,
       0.0, 0.0, true, -62, 0
from devices order by device_uid limit 1;

-- A closed illegal opening: 47 minutes on a hot afternoon.
insert into open_events (device_uid, hydrant_id, opened_at, closed_at, use_classification, classified_by, classified_at)
select d.device_uid, d.hydrant_id,
       now() - interval '3 days' - interval '47 minutes', now() - interval '3 days',
       'illegal', 'dep.dispatch', now() - interval '3 days' + interval '41 minutes'
from devices d order by d.device_uid limit 1;

-- A closed authorized use.
insert into open_events (device_uid, hydrant_id, opened_at, closed_at, use_classification, classified_by, classified_at)
select d.device_uid, d.hydrant_id,
       now() - interval '7 days' - interval '29 minutes', now() - interval '7 days',
       'authorized', 'dep.dispatch', now() - interval '7 days' + interval '5 hours'
from devices d order by d.device_uid offset 1 limit 1;

-- An event still open right now. This is what the console shows live.
insert into open_events (device_uid, hydrant_id, opened_at)
select d.device_uid, d.hydrant_id, now() - interval '18 minutes'
from devices d order by d.device_uid limit 1;

-- Device two: displaced by a vehicle strike.
update devices set last_heartbeat_at = now() - interval '35 minutes'
where device_uid = (select device_uid from devices order by device_uid offset 1 limit 1);

insert into heartbeats (device_uid, recorded_at, trigger, float_wet,
                        pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s)
select device_uid, now() - interval '35 minutes', 'scheduled', false,
       11.40, 4.20, true, -78, 340000
from devices order by device_uid offset 1 limit 1;

insert into faults (device_uid, code, opened_at, detail)
select device_uid, 'HYDRANT_TILTED', now() - interval '35 minutes',
       jsonb_build_object('tilt_delta_deg', 12.14, 'baseline_pitch', 0.0)
from devices order by device_uid offset 1 limit 1;

-- Device three: silent. The fault that matters most, because a dead
-- device cannot report that it is dead.
update devices set last_heartbeat_at = now() - interval '9 hours'
where device_uid = (select device_uid from devices order by device_uid offset 2 limit 1);

insert into faults (device_uid, code, opened_at, detail)
select device_uid, 'DEVICE_OFFLINE', now() - interval '3 hours',
       jsonb_build_object('last_heartbeat_at', (now() - interval '9 hours')::text,
                          'expected_interval_s', 7200)
from devices order by device_uid offset 2 limit 1;
