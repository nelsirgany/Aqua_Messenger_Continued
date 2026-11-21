import postgres from "postgres";
import type { HydrantStatus, DeviceHealth, OpenEventRow } from "./types";

declare global {
  var __aquaSql: ReturnType<typeof postgres> | undefined;
}

// One connection pool, reused across hot reloads in dev.
// postgres.js returns `numeric` as a string by default (to avoid silent
// precision loss); this product only ever displays them, so parse to
// float here once rather than at every call site.
export const sql =
  globalThis.__aquaSql ??
  postgres(process.env.DATABASE_URL!, {
    ssl: process.env.DATABASE_URL?.includes("localhost") ? false : "require",
    types: {
      numeric: {
        to: 0,
        from: [1700],
        serialize: (x: number) => String(x),
        parse: (x: string) => parseFloat(x),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__aquaSql = sql;
}

// Live statuses only: monitored devices and proposed pilot sites. This is
// what the console polls every 10s, so it must stay small — the ~110k
// unmonitored hydrants are served separately and cached (see
// getUnmonitoredField).
export async function getHydrantStatuses(): Promise<HydrantStatus[]> {
  return sql<HydrantStatus[]>`
    select * from v_hydrant_status
    where deployment_state in ('monitored','pilot_proposed')
    order by dep_unit_id
  `;
}

export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

// The grey field, bounded to the current map viewport. Citywide this is
// ~110k rows — unbounded, that is easily tens of megabytes of JSON, and
// Vercel serverless functions cap a response body at 4.5MB (Hobby/Pro).
// So this is queried per-viewport instead of once for the whole city, and
// hard-capped besides: even a bounding box can contain more hydrants than
// is worth drawing, and a cap that's silently hit should not look like
// "there are no more hydrants here."
//
// Returns bare [lon, lat] pairs rather than objects: nothing else about
// an unmonitored hydrant is drawn, and the compact form keeps each
// response small enough to gzip well.
export async function getUnmonitoredField(
  bounds: MapBounds,
  limit = 2000,
): Promise<[number, number][]> {
  const rows = await sql<{ longitude: number; latitude: number }[]>`
    select longitude, latitude from hydrants
    where deployment_state = 'unmonitored'
      and latitude  between ${bounds.minLat} and ${bounds.maxLat}
      and longitude between ${bounds.minLng} and ${bounds.maxLng}
    limit ${limit}
  `;
  return rows.map((r) => [r.longitude, r.latitude]);
}

export async function getDeviceHealth(): Promise<DeviceHealth[]> {
  return sql<DeviceHealth[]>`
    select * from v_device_health
    order by
      case worst_severity
        when 'critical' then 0
        when 'warning'  then 1
        when 'info'     then 2
        else 3
      end,
      device_uid
  `;
}

export async function getOpenEvents(limit = 50): Promise<OpenEventRow[]> {
  return sql<OpenEventRow[]>`
    select * from v_open_events order by opened_at desc limit ${limit}
  `;
}
