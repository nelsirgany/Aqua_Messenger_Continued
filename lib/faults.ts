// Fault evaluation. Single source of truth — see files/claude-code-brief.md
// ("fault logic exists once") and files/api-contract.md section 4.
//
// NYC hydrants are dry-barrel: the main valve sits below the frost line and
// the barrel drains itself after use, so the barrel is dry unless the
// hydrant is open. Wet means flowing. There is no water level to model —
// do not "fix" this later by adding one.
import { sql } from "./db";

const FLOAT_STUCK_WET_HOURS = 6;
const CLOCK_DRIFT_S = 60;
const TILT_FAULT_DEG = 5;

// evaluateFloat only needs enough history to establish "has this been
// continuously wet." 500 rows is generous headroom for any real check-in
// cadence and prevents an unbounded scan as heartbeats accumulate.
const FLOAT_HISTORY_LIMIT = 500;

interface DeviceRow {
  device_uid: string;
  hydrant_id: string | null;
  checkin_interval_s: number;
  install_pitch_deg: number | null;
  install_roll_deg: number | null;
  installed_at: string | null;
}

/**
 * Idempotent by construction: the unique partial index on
 * (device_uid, code) where resolved_at is null means two concurrent
 * callers cannot open the same fault twice.
 *
 * `openedAt` exists for faults detected late — see
 * evaluateOfflineDevices. When omitted the row is stamped now, which is
 * correct for anything detected from an arriving packet.
 *
 * Both openFault and resolveFault write against `fault_codes` via a
 * foreign key on `faults.code`. If a code has been removed from
 * fault_codes, the insert in openFault will fail (FK violation) and
 * resolveFault becomes a silent no-op (nothing to match). Do not delete
 * rows from fault_codes; if a check should stop firing, set
 * fault_codes.is_active = false on it instead — the row must still
 * exist so this file's inserts keep working.
 */
async function openFault(
  deviceUid: string,
  code: string,
  detail: Record<string, unknown> = {},
  openedAt?: string | null,
) {
  await sql`
    insert into faults (device_uid, code, opened_at, detail)
    values (
      ${deviceUid}, ${code},
      ${openedAt ?? new Date().toISOString()},
      ${sql.json(detail as never)}
    )
    on conflict (device_uid, code) where resolved_at is null do nothing
  `;
}

async function resolveFault(deviceUid: string, code: string) {
  await sql`
    update faults set resolved_at = now()
    where device_uid = ${deviceUid} and code = ${code} and resolved_at is null
  `;
}

interface HeartbeatInput {
  recorded_at: string;
  received_at?: string;
  float_wet: boolean;
  pitch_deg: number;
  roll_deg: number;
  imu_ok: boolean;
}

/**
 * Runs every instantaneous (non-offline) check against one heartbeat or
 * event reading. Called by the heartbeat route and the events route.
 */
export async function evaluateReading(
  device: DeviceRow,
  reading: HeartbeatInput,
) {
  // Any heartbeat is proof of life.
  await resolveFault(device.device_uid, "DEVICE_OFFLINE");

  await evaluateFloat(device, reading.float_wet);
  await evaluateImu(device, reading.imu_ok);
  await evaluateTilt(device, reading.pitch_deg, reading.roll_deg);
  await evaluateClockDrift(
    reading.recorded_at,
    reading.received_at ?? new Date().toISOString(),
    device.device_uid,
  );
}

async function evaluateFloat(device: DeviceRow, floatWet: boolean) {
  if (floatWet) {
    // Bounded and simplified: we only need the earliest recorded_at among
    // recent heartbeats that are wet AND have no dry reading after them.
    // The original lag()/gap computation was unused dead weight; this is
    // the same question — "how long has it been continuously wet" — asked
    // directly, over a capped window instead of the full table.
    const recent = await sql<{ recorded_at: string; float_wet: boolean }[]>`
      select recorded_at, float_wet
      from heartbeats
      where device_uid = ${device.device_uid}
      order by recorded_at desc
      limit ${FLOAT_HISTORY_LIMIT}
    `;

    let continuouslyWetSince: string | null = null;
    for (const row of recent) {
      if (!row.float_wet) break; // hit a dry reading, streak ends here
      continuouslyWetSince = row.recorded_at;
    }

    if (continuouslyWetSince) {
      const wetSince = new Date(continuouslyWetSince).getTime();
      const hours = (Date.now() - wetSince) / 3_600_000;
      if (hours > FLOAT_STUCK_WET_HOURS) {
        await openFault(device.device_uid, "FLOAT_STUCK_WET", {
          wet_since: continuouslyWetSince,
        });
      }
    }
    await resolveFault(device.device_uid, "FLOAT_NEVER_WET");
  } else {
    await resolveFault(device.device_uid, "FLOAT_STUCK_WET");

    const [{ has_wet }] = await sql<{ has_wet: boolean }[]>`
      select exists(
        select 1 from heartbeats where device_uid = ${device.device_uid} and float_wet
      ) as has_wet
    `;
    if (!has_wet) {
      const [{ neighbour_has_wet }] = await sql<
        { neighbour_has_wet: boolean }[]
      >`
        select exists(
          select 1 from heartbeats where device_uid <> ${device.device_uid} and float_wet
        ) as neighbour_has_wet
      `;
      if (neighbour_has_wet) {
        await openFault(device.device_uid, "FLOAT_NEVER_WET");
      }
    }
  }
}

async function evaluateImu(device: DeviceRow, imuOk: boolean) {
  if (imuOk) {
    await resolveFault(device.device_uid, "IMU_NO_RESPONSE");
  } else {
    await openFault(device.device_uid, "IMU_NO_RESPONSE");
  }
}

async function evaluateTilt(
  device: DeviceRow,
  pitchDeg: number,
  rollDeg: number,
) {
  const basePitch = device.install_pitch_deg ?? 0;
  const baseRoll = device.install_roll_deg ?? 0;
  const delta = Math.sqrt(
    (pitchDeg - basePitch) ** 2 + (rollDeg - baseRoll) ** 2,
  );
  if (delta > TILT_FAULT_DEG) {
    await openFault(device.device_uid, "HYDRANT_TILTED", {
      tilt_delta_deg: Math.round(delta * 100) / 100,
    });
  } else {
    await resolveFault(device.device_uid, "HYDRANT_TILTED");
  }
}

async function evaluateClockDrift(
  recordedAt: string,
  receivedAt: string,
  deviceUid: string,
) {
  const driftS =
    Math.abs(new Date(receivedAt).getTime() - new Date(recordedAt).getTime()) /
    1000;
  if (driftS > CLOCK_DRIFT_S) {
    await openFault(deviceUid, "CLOCK_DRIFT", { drift_s: Math.round(driftS) });
  } else {
    await resolveFault(deviceUid, "CLOCK_DRIFT");
  }
}

/**
 * Opens DEVICE_OFFLINE for any device silent past 3 check-in intervals.
 *
 * This is the one fault that cannot be evaluated on write. Every other
 * check rides in on a packet, so receiving that packet is the trigger.
 * Offline is defined by the *absence* of a packet, and nothing calls you
 * to tell you nothing arrived. It is therefore evaluated on read, by the
 * console's health reads, rather than on a schedule.
 *
 * The console does not depend on this row to render the state:
 * v_hydrant_status already derives `offline` from last_heartbeat_at
 * against checkin_interval_s. The row exists so the maintenance log has
 * an auditable record, which is what the buyer is actually paying for.
 *
 * Because the row is written whenever someone next looks, opened_at is
 * set to when the device actually crossed the threshold —
 * last_heartbeat_at + 3 intervals — not to the moment of the read. The
 * detail JSON carries both, so a late write is still an honest log.
 */
export async function evaluateOfflineDevices(): Promise<string[]> {
  const stale = await sql<
    {
      device_uid: string;
      last_heartbeat_at: string | null;
      expected_interval_s: number;
      went_offline_at: string | null;
    }[]
  >`
    select device_uid,
           last_heartbeat_at,
           checkin_interval_s as expected_interval_s,
           last_heartbeat_at + (checkin_interval_s * 3 || ' seconds')::interval
             as went_offline_at
    from devices
    where is_active
      and (last_heartbeat_at is null
           or last_heartbeat_at < now() - (checkin_interval_s * 3 || ' seconds')::interval)
  `;

  for (const d of stale) {
    await openFault(
      d.device_uid,
      "DEVICE_OFFLINE",
      {
        last_heartbeat_at: d.last_heartbeat_at,
        expected_interval_s: d.expected_interval_s,
        // When the device actually went silent, versus when a read
        // happened to notice. A device that has never reported has no
        // threshold to cross, so it has no detection time either.
        detected_at: d.went_offline_at,
        recorded_at: new Date().toISOString(),
        evaluated_on: "read",
      },
      d.went_offline_at,
    );
  }
  return stale.map((s) => s.device_uid);
}

export async function getDeviceRow(
  deviceUid: string,
): Promise<DeviceRow | null> {
  const rows = await sql<DeviceRow[]>`
    select device_uid, hydrant_id,
           checkin_interval_s, install_pitch_deg, install_roll_deg, installed_at
    from devices where device_uid = ${deviceUid}
  `;
  return rows[0] ?? null;
}
