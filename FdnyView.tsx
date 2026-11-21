"use client";

// FDNY view: one question per hydrant — in service or out of service —
// plus when it was last verified. Big display type, minimal chrome, a
// search box. An officer does not want a dashboard. See
// files/design-language.md section 7.
import { useMemo, useState } from "react";
import type { HydrantStatus } from "@/lib/types";

const LABEL: Record<string, string> = {
  in_service: "IN SERVICE",
  flowing: "IN SERVICE — FLOWING",
  out_of_service: "OUT OF SERVICE",
  offline: "OUT OF SERVICE",
  never_reported: "UNVERIFIED",
  unmonitored: "UNMONITORED",
};

function isOut(state: string): boolean {
  return state === "out_of_service" || state === "offline";
}

export function FdnyView({ hydrants }: { hydrants: HydrantStatus[] }) {
  const [query, setQuery] = useState("");
  const monitored = useMemo(() => hydrants.filter((h) => h.deployment_state === "monitored"), [hydrants]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return monitored;
    return monitored.filter((h) => h.dep_unit_id.toLowerCase().includes(q));
  }, [monitored, query]);

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-12 flex flex-col gap-8 items-center">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="SEARCH DEP UNIT ID"
        className="font-display uppercase tracking-[0.03em] text-2xl text-center border-b-2 border-navy bg-transparent w-full max-w-xl px-2 py-3 focus:outline-none placeholder:text-grey"
      />

      <div className="w-full max-w-xl flex flex-col gap-4">
        {filtered.map((h) => (
          <div
            key={h.hydrant_id}
            className={`p-6 flex flex-col items-center gap-2 ${
              isOut(h.service_state) ? "bg-alert text-white" : "bg-white text-black border border-rule"
            }`}
          >
            <div className="font-data text-lg">{h.dep_unit_id}</div>
            <div className="font-display uppercase tracking-[0.03em] text-4xl">
              {LABEL[h.service_state] ?? h.service_state.toUpperCase()}
            </div>
            <div
              className={`text-[0.75rem] uppercase tracking-[0.06em] ${
                isOut(h.service_state) ? "text-white/70" : "text-grey"
              }`}
            >
              last verified{" "}
              <span className="font-data normal-case">
                {h.last_heartbeat_at ? new Date(h.last_heartbeat_at).toLocaleString() : "never"}
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-grey text-sm">No monitored hydrant matches that ID.</p>
        )}
      </div>
    </div>
  );
}
