// Device health queue, sorted worst severity first. Severity is encoded by
// inversion and weight only — see files/design-language.md section 2.
import type { DeviceHealth } from "@/lib/types";
import { BarrelGlyph } from "./BarrelGlyph";

// A device issue is filled --alert, not merely tinted: the panel stays a
// solid block so severity still reads in greyscale if the hue is lost.
function panelClasses(worst: DeviceHealth["worst_severity"]): string {
  if (worst === "critical") return "bg-alert text-white border-0";
  if (worst === "warning") return "bg-white text-black border border-rule border-l-[3px] border-l-alert";
  return "bg-white text-black border border-rule";
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function HealthQueue({ devices }: { devices: DeviceHealth[] }) {
  return (
    <section aria-label="Device health queue">
      <h2 className="font-display text-[0.6875rem] uppercase tracking-[0.14em] text-grey mb-2">
        Device Health
      </h2>
      <ul className="flex flex-col gap-2">
        {devices.map((d) => {
          const critical = d.worst_severity === "critical";
          const muted = critical ? "text-white/70" : "text-grey";
          return (
            <li key={d.device_uid} className={`p-3 flex items-center gap-3 ${panelClasses(d.worst_severity)}`}>
              <BarrelGlyph
                wet={Boolean(d.float_wet)}
                tiltDeg={d.tilt_delta_deg ?? 0}
                critical={critical}
                size={40}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-display uppercase tracking-[0.03em] text-sm">{d.dep_unit_id ?? "—"}</span>
                  <span className={`font-data text-[0.8125rem] ${muted}`}>{d.device_uid}</span>
                </div>
                <div className={`text-[0.75rem] uppercase tracking-[0.06em] font-body font-semibold ${muted}`}>
                  {d.street_address ?? "Address unavailable"}
                </div>
              </div>
              <div className="text-right">
                <div className={`text-[0.6875rem] uppercase tracking-[0.06em] ${muted}`}>last heartbeat</div>
                <div className="font-data text-[0.8125rem]">{relativeTime(d.last_heartbeat_at)}</div>
              </div>
              {/* The actual fault names, not a bare count — this is what the
                  reviewer needs to see, and what a count alone hides. */}
              {d.open_fault_titles.length > 0 ? (
                <div className="text-right max-w-[40%]">
                  <div className={`text-[0.6875rem] uppercase tracking-[0.06em] ${muted}`}>
                    {d.open_fault_titles.length} open fault{d.open_fault_titles.length > 1 ? "s" : ""}
                  </div>
                  <div className="text-[0.8125rem] font-semibold leading-snug">
                    {d.open_fault_titles.join(" · ")}
                  </div>
                </div>
              ) : (
                <span className={`text-[0.75rem] uppercase tracking-[0.06em] ${muted}`}>Normal</span>
              )}
            </li>
          );
        })}
        {devices.length === 0 && <li className="text-grey text-sm p-3">No devices deployed yet.</li>}
      </ul>
    </section>
  );
}
