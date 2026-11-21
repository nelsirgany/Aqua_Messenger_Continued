import { NextRequest, NextResponse } from "next/server";
import { getUnmonitoredField } from "@/lib/db";

// The grey field, one viewport at a time. See the comment on
// getUnmonitoredField in lib/db.ts for why this is bounded: unbounded,
// this endpoint would ship all ~110k unmonitored hydrants in one
// response, comfortably over Vercel's 4.5MB serverless response cap.
//
// The map calls this on load and on moveend (debounced), so it is
// per-viewport rather than per-session, and cached briefly rather than
// hard — the bbox+limit query string is the cache key, and a panned map
// asks a different question each time.
export const dynamic = "force-dynamic";

const HARD_LIMIT = 2000;

// `Number(null)` is 0, not NaN — a param that's simply absent must be
// rejected explicitly, or a missing bbox silently becomes a valid (and
// wrong) box collapsed at (0, 0).
function requireFiniteParam(sp: URLSearchParams, key: string): number | null {
  const raw = sp.get(key);
  if (raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const minLat = requireFiniteParam(sp, "minLat");
  const maxLat = requireFiniteParam(sp, "maxLat");
  const minLng = requireFiniteParam(sp, "minLng");
  const maxLng = requireFiniteParam(sp, "maxLng");
  const requestedLimit = requireFiniteParam(sp, "limit") ?? HARD_LIMIT;

  if (minLat === null || maxLat === null || minLng === null || maxLng === null) {
    return NextResponse.json(
      { error: "minLat, maxLat, minLng, maxLng are required and must be numbers" },
      { status: 422 },
    );
  }

  // The client's requested limit is a ceiling, never an escalation — a
  // caller cannot ask its way past HARD_LIMIT.
  const limit = Math.min(requestedLimit, HARD_LIMIT);

  const field = await getUnmonitoredField({ minLat, maxLat, minLng, maxLng }, limit);
  return NextResponse.json(field, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" },
  });
}
