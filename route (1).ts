import { NextRequest, NextResponse } from "next/server";
import { getOpenEvents } from "@/lib/db";

export async function GET(req: NextRequest) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
  return NextResponse.json(await getOpenEvents(Number.isFinite(limit) ? limit : 50));
}
