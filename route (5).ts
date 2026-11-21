import { NextResponse } from "next/server";
import { evaluateOfflineDevices } from "@/lib/faults";

/**
 * Retained, but nothing on Vercel calls it.
 *
 * Vercel's Hobby plan allows two cron invocations per day, which is
 * useless against a three-hour offline threshold, so DEVICE_OFFLINE is
 * evaluated on read instead — see lib/faults.ts and the console's health
 * reads. This route stays because it is the same function behind a URL,
 * which makes it the drop-in target for either upgrade path:
 *
 *   - an external pinger (GitHub Actions schedule, cron-job.org) hitting
 *     it every 15 minutes, or
 *   - nothing at all, once pg_cron inside Supabase takes over (roadmap).
 *
 * It is safe to call at any frequency: opening a fault is idempotent.
 */
export async function GET() {
  const opened = await evaluateOfflineDevices();
  return NextResponse.json({ ok: true, offline_opened_for: opened });
}
