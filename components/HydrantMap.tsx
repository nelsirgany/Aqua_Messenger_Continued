"use client";

// Client component. Real NYC hydrants from NYC Open Data 6pui-xhxz,
// sampled to one neighborhood. See files/design-language.md section 6.
//
// Plain light base with --mist landmass, chosen once and never mixed with
// the inverted navy variant. Free raster tiles (CARTO Positron), no token,
// no billing.
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { hasDeviceIssue, isIllegalUse, type HydrantStatus } from "@/lib/types";

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// Built fresh per Map instance, never shared. MapLibre takes ownership of
// the style spec it is handed and tears it down on map.remove(), so a
// module-scope constant would leave the next map (React StrictMode mounts
// effects twice in dev) initialising from an already-disposed style: the
// raster base still paints but the style never finishes loading and no
// circle layer ever renders.
function buildStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
          "https://b.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
          "https://c.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; OpenStreetMap contributors',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#EEF1F4" } },
      { id: "basemap", type: "raster", source: "basemap" },
    ],
  };
}

export function HydrantMap({ hydrants }: { hydrants: HydrantStatus[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: hydrants.length
        ? [hydrants[0].longitude, hydrants[0].latitude]
        : [-73.9865, 40.6942],
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on("load", () => {
      // The citywide grey field: ~110k points, loaded once from a cached
      // endpoint and never polled. Drawn beneath every live layer.
      map.addSource("field", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "hydrants-unmonitored",
        type: "circle",
        source: "field",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 2, 17, 3.5],
          "circle-color": "#8A939C",
          "circle-opacity": 0.55,
        },
      });

      const loadField = () => {
        const b = map.getBounds();
        const params = new URLSearchParams({
          minLat: String(b.getSouth()),
          maxLat: String(b.getNorth()),
          minLng: String(b.getWest()),
          maxLng: String(b.getEast()),
        });
        fetch(`/api/console/field?${params}`)
          .then((r) => r.json())
          .then((coords: [number, number][]) => {
            const src = map.getSource("field") as maplibregl.GeoJSONSource | undefined;
            src?.setData({
              type: "FeatureCollection",
              features: coords.map((c) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: c },
                properties: {},
              })),
            });
          })
          .catch(() => {
            // The grey field is context, not the demo. If it fails to
            // load the live devices below still render.
          });
      };

      loadField();

      // Refetch per viewport rather than once for the whole city — see
      // the field endpoint for why. Debounced so a drag doesn't fire one
      // request per frame.
      let debounce: ReturnType<typeof setTimeout>;
      map.on("moveend", () => {
        clearTimeout(debounce);
        debounce = setTimeout(loadField, 300);
      });

      map.addSource("hydrants", { type: "geojson", data: toGeoJSON(hydrants) });

      map.addLayer({
        id: "hydrants-pilot",
        type: "circle",
        source: "hydrants",
        filter: ["==", ["get", "deployment_state"], "pilot_proposed"],
        paint: {
          "circle-radius": 8,
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#8A939C",
        },
      });

      map.addLayer({
        id: "hydrants-monitored",
        type: "circle",
        source: "hydrants",
        filter: ["==", ["get", "deployment_state"], "monitored"],
        paint: {
          // Device issues are red; water a human has classified as illegal
          // is bright blue; an unclassified opening stays the desaturated
          // --blue, because the system must never call a use illegal on
          // its own. Normal is a navy ring with a white centre.
          "circle-color": [
            "case",
            ["get", "has_device_issue"], "#C1121F",
            ["get", "is_illegal_use"], "#00B4D8",
            ["==", ["get", "service_state"], "flowing"], "#4A6E93",
            "#FFFFFF",
          ],
          "circle-radius": ["case", ["get", "has_device_issue"], 9, 8],
          "circle-stroke-width": 2,
          "circle-stroke-color": [
            "case",
            ["get", "has_device_issue"], "#05080C",
            ["get", "is_illegal_use"], "#05080C",
            "#0B1F3A",
          ],
        },
      });

      map.on("click", ["hydrants-monitored", "hydrants-pilot"], (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, unknown>;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div style="font-family:var(--font-body);font-size:12px;color:#0B1F3A">
              <strong style="font-family:var(--font-data)">${p.dep_unit_id}</strong><br/>
              ${p.device_uid ? `Device ${p.device_uid}<br/>` : ""}
              ${String(p.street_address ?? "")}<br/>
              <span style="text-transform:uppercase;letter-spacing:.06em;font-size:10px;color:#8A939C">${p.service_state ?? p.deployment_state}</span>
            </div>`
          )
          .addTo(map);
      });

      for (const id of ["hydrants-monitored", "hydrants-pilot"]) {
        map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("hydrants")) return;
    (map.getSource("hydrants") as maplibregl.GeoJSONSource).setData(toGeoJSON(hydrants));
  }, [hydrants]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" aria-hidden="true" />
      <Legend />
      <VisuallyHiddenFaultList hydrants={hydrants} />
    </div>
  );
}

// Once severity carries hue, the map needs a key. The dry/wet barrel
// glyph never did — that one teaches itself.
function Legend() {
  const items: [string, string, string][] = [
    ["Device issue", "var(--alert)", "solid"],
    ["Illegal use", "var(--illegal)", "solid"],
    ["Flowing", "var(--blue)", "solid"],
    ["Normal", "#FFFFFF", "ring"],
    ["Pilot proposed", "transparent", "ring-grey"],
    ["Unmonitored", "var(--grey)", "dot"],
  ];
  return (
    <div className="absolute left-2 bottom-2 bg-white/95 border border-rule p-2 flex flex-col gap-1">
      {items.map(([label, color, kind]) => (
        <div key={label} className="flex items-center gap-2">
          {/* SVG rather than a styled span: the console zeroes every
              border-radius globally, which would square these off. */}
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
            <circle
              cx="7"
              cy="7"
              r={kind === "dot" ? 2.5 : 5}
              fill={color}
              stroke={
                kind === "ring" ? "var(--navy)" : kind === "ring-grey" ? "var(--grey)" : "none"
              }
              strokeWidth={kind === "ring" || kind === "ring-grey" ? 2 : 0}
            />
          </svg>
          <span className="text-[0.6875rem] uppercase tracking-[0.06em] text-navy whitespace-nowrap">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function toGeoJSON(hydrants: HydrantStatus[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: hydrants.map((h) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [h.longitude, h.latitude] },
      // The two severity flags are precomputed here so the paint
      // expressions stay declarative rather than re-deriving the rules.
      properties: {
        ...h,
        has_device_issue: hasDeviceIssue(h),
        is_illegal_use: isIllegalUse(h),
      },
    })),
  };
}

// Accessibility floor: the console must be usable without the map
// rendering at all. See files/design-language.md section 9.
function VisuallyHiddenFaultList({ hydrants }: { hydrants: HydrantStatus[] }) {
  const flagged = hydrants.filter((h) => hasDeviceIssue(h) || isIllegalUse(h));
  return (
    <ul className="sr-only">
      {flagged.map((h) => (
        <li key={h.hydrant_id}>
          {h.dep_unit_id} ({h.device_uid}): {h.service_state}
          {hasDeviceIssue(h) ? `, device issue, ${h.critical_faults} critical fault(s)` : ""}
          {isIllegalUse(h) ? ", water use classified illegal" : ""}
        </li>
      ))}
    </ul>
  );
}
