"use client";

// Toggle top right, display face, DEP / FDNY. Same database, different
// question. See files/design-language.md section 7.
export type Role = "DEP" | "FDNY";

export function RoleToggle({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <div className="flex border border-navy" role="group" aria-label="Console role">
      {(["DEP", "FDNY"] as const).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          aria-pressed={role === r}
          className={`font-display uppercase tracking-[0.03em] text-sm px-4 py-2 transition-none ${
            role === r ? "bg-navy text-white" : "bg-white text-navy"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
