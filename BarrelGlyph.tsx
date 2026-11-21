// The signature element. A small vertical section drawing of a dry-barrel
// hydrant: bonnet, upper barrel, ground line, lower barrel, main valve
// below the frost line. See files/design-language.md section 5.
//
// Dry (empty outline) is the resting state for every healthy hydrant —
// NYC hydrants are dry-barrel, so a filled glyph means water is flowing
// right now. Nobody needs a legend.
import { useId } from "react";

interface BarrelGlyphProps {
  wet: boolean;
  tiltDeg?: number;
  /** Device issue — fills the plate in --alert and inverts the linework. */
  critical?: boolean;
  /** Water use a human classified as illegal — fills the barrel bright. */
  illegal?: boolean;
  size?: number;
  className?: string;
}

const GROUND_Y = 24;
const BARREL_BOTTOM_Y = 46;

export function BarrelGlyph({
  wet,
  tiltDeg = 0,
  critical = false,
  illegal = false,
  size = 56,
  className = "",
}: BarrelGlyphProps) {
  const width = Math.round((size * 24) / 56);
  // Unique per instance: duplicate clipPath ids across glyphs on one page
  // would make every barrel clip to whichever definition rendered first.
  const clipId = useId().replace(/:/g, "") + "-barrel";
  const outline = critical ? "#ffffff" : "var(--navy)";
  const fill = critical ? "#ffffff" : illegal ? "var(--illegal)" : "var(--blue)";

  return (
    <svg
      viewBox="0 0 24 56"
      width={width}
      height={size}
      className={className}
      role="img"
      aria-label={
        critical
          ? "Hydrant in critical fault state"
          : wet
            ? "Hydrant flowing"
            : "Hydrant dry, normal"
      }
    >
      {critical && <rect x="0" y="0" width="24" height="56" fill="var(--alert)" />}
      <g
        style={{
          transform: `rotate(${tiltDeg}deg)`,
          transformOrigin: `12px ${GROUND_Y}px`,
        }}
      >
        <clipPath id={clipId}>
          <path d="M8,10 L16,10 L16,46 L15,50 L9,50 L8,46 Z" />
        </clipPath>

        {/* Fill, clipped to the barrel interior, rising from the ground line. */}
        <rect
          x="6"
          y={GROUND_Y}
          width="12"
          height={BARREL_BOTTOM_Y - GROUND_Y}
          fill={fill}
          clipPath={`url(#${clipId})`}
          className="barrel-fill"
          style={{
            transform: wet ? "scaleY(1)" : "scaleY(0)",
            transformOrigin: `12px ${BARREL_BOTTOM_Y}px`,
            transition: "transform 300ms ease-out",
          }}
        />

        {/* Bonnet */}
        <path
          d="M9,10 L9,4 Q9,1 12,1 Q15,1 15,4 L15,10 Z"
          fill="none"
          stroke={outline}
          strokeWidth="1.5"
        />
        {/* Nozzle caps */}
        <line x1="6" y1="7" x2="9" y2="7" stroke={outline} strokeWidth="1.5" />
        <line x1="15" y1="7" x2="18" y2="7" stroke={outline} strokeWidth="1.5" />

        {/* Upper barrel */}
        <path
          d="M8,10 L16,10 L16,24"
          fill="none"
          stroke={outline}
          strokeWidth="1.5"
        />
        <path d="M8,10 L8,24" fill="none" stroke={outline} strokeWidth="1.5" />

        {/* Ground line */}
        <line x1="2" y1={GROUND_Y} x2="22" y2={GROUND_Y} stroke={outline} strokeWidth="1" strokeDasharray="2,2" />

        {/* Lower barrel, below grade */}
        <path
          d="M8,24 L8,46 L9,50 L15,50 L16,46 L16,24"
          fill="none"
          stroke={outline}
          strokeWidth="1.5"
        />

        {/* Frost line */}
        <line x1="4" y1="42" x2="20" y2="42" stroke={outline} strokeWidth="0.75" strokeDasharray="1,2" opacity="0.6" />

        {/* Main valve, below the frost line */}
        <rect x="10" y="50" width="4" height="4" fill="none" stroke={outline} strokeWidth="1.5" />
      </g>

      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .barrel-fill { transition: none !important; }
        }
      `}</style>
    </svg>
  );
}
