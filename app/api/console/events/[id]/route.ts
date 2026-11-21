import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import type { UseClassification } from "@/lib/types";

const VALID: UseClassification[] = ["unclassified", "authorized", "illegal", "test"];

// The only write the console makes. The system never classifies an
// opening automatically — a human tags it. See
// files/design-language.md section 8.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const useClassification = body.use_classification as UseClassification;

  if (!VALID.includes(useClassification)) {
    return NextResponse.json({ error: "invalid use_classification" }, { status: 422 });
  }

  const classifiedBy = typeof body.classified_by === "string" ? body.classified_by : "dep.console";

  const [row] = await sql`
    update open_events
    set use_classification = ${useClassification},
        classified_by = ${classifiedBy},
        classified_at = now()
    where id = ${id}
    returning id, use_classification, classified_by, classified_at
  `;

  if (!row) {
    return NextResponse.json({ error: "event not found" }, { status: 404 });
  }

  return NextResponse.json(row);
}
