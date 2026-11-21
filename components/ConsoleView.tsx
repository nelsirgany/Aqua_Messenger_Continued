"use client";

// Client shell for /console: holds the DEP/FDNY role state and polls the
// live hydrant feed. The page itself stays a server component that does
// the first fetch — see files/api-contract.md section 5 for the polling
// contract (10s, no websockets).
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { HydrantStatus, DeviceHealth, OpenEventRow } from "@/lib/types";
import { RoleToggle, type Role } from "./RoleToggle";
import { HealthQueue } from "./HealthQueue";
import { EventLog } from "./EventLog";
import { FdnyView } from "./FdnyView";

const HydrantMap = dynamic(() => import("./HydrantMap").then((m) => m.HydrantMap), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-mist" />,
});

export function ConsoleView({
  initialHydrants,
  health,
  events,
}: {
  initialHydrants: HydrantStatus[];
  health: DeviceHealth[];
  events: OpenEventRow[];
}) {
  const [role, setRole] = useState<Role>("DEP");
  const [hydrants, setHydrants] = useState(initialHydrants);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/console/hydrants", { cache: "no-store" });
        if (res.ok) setHydrants(await res.json());
      } catch {
        // Polling is best-effort; seeded data stays on screen if it fails.
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-rule">
        <div>
          <h1 className="font-display uppercase tracking-[0.03em] text-xl text-navy">Aqua Messenger</h1>
          <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-grey">NYC DEP Operations Console</p>
        </div>
        <RoleToggle role={role} onChange={setRole} />
      </header>

      {role === "DEP" ? (
        <div className="flex flex-col md:flex-row flex-1 min-h-0">
          <div className="h-[40vh] md:h-auto md:w-[60%] p-2">
            <HydrantMap hydrants={hydrants} />
          </div>
          <div className="flex-1 md:w-[40%] overflow-y-auto p-4 flex flex-col gap-6">
            <HealthQueue devices={health} />
            <EventLog events={events} />
          </div>
        </div>
      ) : (
        <FdnyView hydrants={hydrants} />
      )}
    </div>
  );
}
