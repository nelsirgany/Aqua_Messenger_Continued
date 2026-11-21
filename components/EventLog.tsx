"use client";

// Open-event log. Every gallon figure carries its assumption, and events
// stay unclassified until a human tags them — the system cannot tell FDNY
// from a kid with a wrench. See files/design-language.md section 8.
import { useState, useTransition } from "react";
import type { OpenEventRow, UseClassification } from "@/lib/types";

function formatDuration(row: OpenEventRow): string {
  if (row.closed_at) return `${row.duration_minutes} min`;
  const mins = Math.round((Date.now() - new Date(row.opened_at).getTime()) / 60000);
  return `${mins} min · flowing now`;
}

export function EventLog({ events: initial }: { events: OpenEventRow[] }) {
  const [events, setEvents] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function classify(id: string, label: UseClassification) {
    startTransition(async () => {
      const res = await fetch(`/api/console/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ use_classification: label, classified_by: "dep.console" }),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === id
              ? { ...e, use_classification: label, classified_by: "dep.console", classified_at: new Date().toISOString() }
              : e
          )
        );
      }
    });
  }

  return (
    <section aria-label="Open hydrant events">
      <h2 className="font-display text-[0.6875rem] uppercase tracking-[0.14em] text-grey mb-2">
        Open Events
      </h2>
      <ul className="flex flex-col gap-2">
        {events.map((e) => {
          // Bright fill only once a person has tagged the use illegal.
          const illegal = e.use_classification === "illegal";
          const muted = illegal ? "text-black/70" : "text-grey";
          return (
          <li
            key={e.id}
            className={illegal ? "bg-illegal text-black border-0 p-3" : "border border-rule p-3"}
          >
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="font-display uppercase tracking-[0.03em] text-sm">
                {e.dep_unit_id ?? e.device_uid}
              </span>
              <span className={`font-data text-[0.8125rem] ${muted}`}>
                {new Date(e.opened_at).toLocaleString()}
              </span>
            </div>
            <div className={`text-[0.75rem] ${muted}`}>{e.street_address}</div>
            <div className="font-data text-[0.9375rem] mt-1">
              {formatDuration(e)}
              {e.est_gallons !== null && (
                <>
                  {" · "}
                  est. {e.est_gallons.toLocaleString()} gal @ {e.nominal_flow_gpm.toLocaleString()} gpm nominal
                </>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[0.6875rem] uppercase tracking-[0.06em] ${muted}`}>
                {e.use_classification === "unclassified" ? "Unclassified" : `Classified: ${e.use_classification}`}
                {e.classified_by ? ` by ${e.classified_by}` : ""}
              </span>
              {e.use_classification === "unclassified" && (
                <div className="flex gap-1 ml-auto">
                  <button
                    disabled={isPending}
                    onClick={() => classify(e.id, "authorized")}
                    className="border border-navy px-2 py-1 text-[0.6875rem] uppercase tracking-[0.06em] font-body font-semibold hover:bg-navy hover:text-white"
                  >
                    Authorized
                  </button>
                  <button
                    disabled={isPending}
                    onClick={() => classify(e.id, "illegal")}
                    className="border border-navy px-2 py-1 text-[0.6875rem] uppercase tracking-[0.06em] font-body font-semibold hover:bg-navy hover:text-white"
                  >
                    Illegal
                  </button>
                </div>
              )}
            </div>
          </li>
          );
        })}
        {events.length === 0 && <li className="text-grey text-sm p-3">No open events yet.</li>}
      </ul>
    </section>
  );
}
