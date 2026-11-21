import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { checkDeviceKey } from "@/lib/auth";
import { evaluateReading, getDeviceRow } from "@/lib/faults";
import {
  checkAngleDeg,
  checkEventType,
  checkRecordedAt,
  requireDeviceUid,
  ValidationError,
} from "@/lib/validate";

// Fired the instant the float transitions. Debounce lives in firmware
// (10s hold), not here. See files/api-contract.md section 2.
export async function POST(req: NextRequest) {
  if (!checkDeviceKey(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const deviceUid = requireDeviceUid(body.device_uid);
    const eventType = checkEventType(body.event);
    const occurredAt = checkRecordedAt(body.occurred_at);
    const floatWet = Boolean(body.float_wet);
    const pitchDeg = checkAngleDeg(body.pitch_deg, "pitch_deg");
    const rollDeg = checkAngleDeg(body.roll_deg, "roll_deg");

    const device = await getDeviceRow(deviceUid);
    if (!device) {
      return NextResponse.json(
        { error: "unknown device_uid" },
        { status: 422 },
      );
    }

    let hydrantDepUnitId: string | null = null;
    if (device.hydrant_id) {
      const [h] = await sql<
        { dep_unit_id: string }[]
      >`select dep_unit_id from hydrants where id = ${device.hydrant_id}`;
      hydrantDepUnitId = h?.dep_unit_id ?? null;
    }

    let eventId: string;
    let state: "open" | "closed";

    if (eventType === "opened") {
      const [existing] = await sql<{ id: string }[]>`
        select id from open_events where device_uid = ${deviceUid} and closed_at is null
      `;
      if (existing) {
        eventId = existing.id;
      } else {
        const [inserted] = await sql<{ id: string }[]>`
          insert into open_events (device_uid, hydrant_id, opened_at)
          values (${deviceUid}, ${device.hydrant_id}, ${occurredAt})
          returning id
        `;
        eventId = inserted.id;
      }
      state = "open";
    } else {
      const [openRow] = await sql<{ id: string }[]>`
        select id from open_events where device_uid = ${deviceUid} and closed_at is null
      `;
      if (openRow) {
        await sql`update open_events set closed_at = ${occurredAt} where id = ${openRow.id}`;
        eventId = openRow.id;
      } else {
        const [lastWet] = await sql<{ recorded_at: string }[]>`
          select recorded_at from heartbeats
          where device_uid = ${deviceUid} and float_wet
          order by recorded_at desc limit 1
        `;
        const openedAt = lastWet?.recorded_at ?? occurredAt;
        const [inserted] = await sql<{ id: string }[]>`
          insert into open_events (device_uid, hydrant_id, opened_at, closed_at, notes)
          values (${deviceUid}, ${device.hydrant_id}, ${openedAt}, ${occurredAt}, 'reconstructed: closing POST arrived with no open event')
          returning id
        `;
        eventId = inserted.id;
      }
      state = "closed";
    }

    const receivedAt = new Date().toISOString();
    await sql`
      insert into heartbeats
        (device_uid, recorded_at, received_at, trigger, float_wet, pitch_deg, roll_deg, imu_ok)
      values
        (${deviceUid}, ${occurredAt}, ${receivedAt}, 'event', ${floatWet}, ${pitchDeg}, ${rollDeg}, true)
    `;
    await sql`update devices set last_heartbeat_at = ${receivedAt} where device_uid = ${deviceUid}`;

    await evaluateReading(device, {
      recorded_at: occurredAt,
      received_at: receivedAt,
      float_wet: floatWet,
      pitch_deg: pitchDeg,
      roll_deg: rollDeg,
      imu_ok: true,
    });

    return NextResponse.json(
      { event_id: eventId, state, hydrant: hydrantDepUnitId },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
