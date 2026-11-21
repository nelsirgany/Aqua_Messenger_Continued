-- Removes battery entirely: the battery_profiles table, the two
-- battery-related columns on devices and heartbeats, and the three
-- battery fault codes (and any open faults using them).
--
-- Run once against an existing database (e.g. the Supabase project in
-- .env.local). A fresh database doesn't need this — db/schema.sql no
-- longer creates any of this in the first place.
--
--   npx dotenv -e .env.local -- sh -c 'psql "$DATABASE_URL" -f db/migrations/0001_remove_battery.sql'

begin;

-- v_device_health selects battery_v and joins battery_profiles, so it
-- has to go before the columns/table it depends on can be dropped.
drop view if exists v_device_health;

-- Faults reference fault_codes by foreign key, so clear any open battery
-- faults before deleting the codes themselves. Resolved ones are left in
-- place — they're history, not state.
delete from faults
 where code in ('BATTERY_WARNING', 'BATTERY_CRITICAL', 'BATTERY_NOT_FITTED')
   and resolved_at is null;

delete from fault_codes
 where code in ('BATTERY_WARNING', 'BATTERY_CRITICAL', 'BATTERY_NOT_FITTED');

alter table devices drop column if exists battery_profile;
alter table devices drop column if exists has_battery_sense;
alter table heartbeats drop column if exists battery_v;

drop table if exists battery_profiles;

-- Recreate v_device_health without any battery columns, and with the
-- actual fault names (open_fault_titles) instead of just a count — the
-- console showed "N open faults" with no way to tell what kind.
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

commit;
