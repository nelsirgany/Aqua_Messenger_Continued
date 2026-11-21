import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkDeviceKey } from "@/lib/auth";
import { evaluateReading, getDeviceRow } from "@/lib/faults";
import { checkAngleDeg, checkRecordedAt, requireDeviceUid, ValidationError } from "@/lib/validate";

export async function POST(req: NextRequest) {
  if (!checkDeviceKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const deviceUid = requireDeviceUid(body.device_uid);
    const recordedAt = checkRecordedAt(body.recorded_at);
    const pitchDeg = checkAngleDeg(body.pitch_deg, "pitch_deg");
    const rollDeg = checkAngleDeg(body.roll_deg, "roll_deg");
    const floatWet = Boolean(body.float_wet);
    const imuOkRaw = body.imu_ok !== false;
    const trigger = body.trigger ?? "scheduled";

    const device = await getDeviceRow(deviceUid);
    if (!device) {
      return NextResponse.json({ error: "unknown device_uid" }, { status: 422 });
    }

    const receivedAt = new Date().toISOString();

    const selftest = trigger === "weekly_selftest" ? body.selftest : null;
    const imuOk = selftest ? imuOkRaw && selftest.imu_i2c_ack && selftest.imu_self_test_passed : imuOkRaw;

    await sql`
      insert into heartbeats
        (device_uid, recorded_at, received_at, trigger, float_wet,
         pitch_deg, roll_deg, imu_ok, rssi_dbm, uptime_s, selftest)
      values
        (${deviceUid}, ${recordedAt}, ${receivedAt}, ${trigger}, ${floatWet},
         ${pitchDeg}, ${rollDeg}, ${imuOk}, ${body.rssi_dbm ?? null}, ${body.uptime_s ?? null},
         ${selftest ? sql.json(selftest) : null})
    `;

    await sql`update devices set last_heartbeat_at = ${receivedAt} where device_uid = ${deviceUid}`;

    await evaluateReading(device, {
      recorded_at: recordedAt,
      received_at: receivedAt,
      float_wet: floatWet,
      pitch_deg: pitchDeg,
      roll_deg: rollDeg,
      imu_ok: imuOk,
    });

    // Self-healing reconciliation: a lost open/close POST is fixed by the
    // next heartbeat rather than left to drift. See
    // files/api-contract.md section 1, step 4.
    const [openEvent] = await sql<{ id: string }[]>`
      select id from open_events where device_uid = ${deviceUid} and closed_at is null
    `;
    if (floatWet && !openEvent) {
      await sql`
        insert into open_events (device_uid, hydrant_id, opened_at, notes)
        values (${deviceUid}, ${device.hydrant_id}, ${recordedAt}, 'reconstructed from heartbeat')
        on conflict (device_uid) where closed_at is null do nothing
      `;
    } else if (!floatWet && openEvent) {
      await sql`update open_events set closed_at = ${recordedAt} where id = ${openEvent.id}`;
    }

    const openFaults = await sql<{ code: string }[]>`
      select code from faults where device_uid = ${deviceUid} and resolved_at is null
    `;

    return NextResponse.json({ ok: true, faults_open: openFaults.map((f) => f.code) });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
