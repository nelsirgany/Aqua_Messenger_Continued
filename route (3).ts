import { NextResponse } from "next/server";
import { getDeviceHealth } from "@/lib/db";
import { evaluateOfflineDevices } from "@/lib/faults";

export const dynamic = "force-dynamic";

export async function GET() {
  // Evaluate before reading, so the payload includes any fault this read
  // just opened. DEVICE_OFFLINE is evaluated here rather than on a
  // schedule because the absence of data cannot trigger a webhook.
  await evaluateOfflineDevices();
  return NextResponse.json(await getDeviceHealth());
}
